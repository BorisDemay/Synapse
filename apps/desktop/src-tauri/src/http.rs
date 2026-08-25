use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use reqwest::StatusCode;
use reqwest::header::{CONTENT_TYPE, COOKIE, HeaderMap, HeaderValue, ORIGIN, SET_COOKIE};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use synapse_core::VaultId;
use synapse_protocol::v1::{
    Conflict, EncryptedPushOperation, PullRequest, PullResponse, SyncCursor,
};
use synapse_sync::client::{PullOutcome, PushAck, TransportError};
use url::Url;

#[derive(Debug, Deserialize, Serialize)]
pub struct SessionInfo {
    pub user_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SessionListItem {
    pub created_at: String,
    pub current: bool,
    pub id: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SessionList {
    pub email: String,
    pub sessions: Vec<SessionListItem>,
}

/// Closed request set exposed to the desktop webview.  This deliberately is
/// not a generic HTTP proxy: every variant maps to one documented Synapse API
/// operation and credentials remain in this Rust process.
#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SynapseRequest {
    Session,
    PublicSignup,
    Signup {
        body: SignupBody,
    },
    Login {
        body: LoginBody,
    },
    Logout,
    ChangePassword {
        body: ChangePasswordBody,
    },
    Sessions,
    RevokeOtherSessions,
    RevokeSession {
        session_id: String,
    },
    DeleteAccount {
        body: DeleteAccountBody,
    },
    ListVaults,
    CreateVault,
    GetEnvelope {
        vault_id: String,
    },
    PutEnvelope {
        vault_id: String,
        body: EnvelopeBody,
    },
    Pull {
        vault_id: String,
        query: String,
    },
    Push {
        vault_id: String,
        body: EncryptedPushOperation,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LoginBody {
    email: String,
    password: String,
    #[serde(default)]
    remember_device: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SignupBody {
    email: String,
    invitation_token: Option<String>,
    password: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ChangePasswordBody {
    current_password: String,
    new_password: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DeleteAccountBody {
    password: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EnvelopeBody {
    bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
pub struct SynapseResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<serde_json::Value>,
    pub status: u16,
}

pub struct InstanceClient {
    client: reqwest::Client,
    base: Url,
    session: Mutex<Option<String>>,
    session_store: Option<PathBuf>,
}

impl InstanceClient {
    pub fn connect(raw: &str) -> Result<Self, String> {
        Self::connect_with_session_store(raw, None)
    }

    pub fn connect_with_session_store(raw: &str, store: Option<PathBuf>) -> Result<Self, String> {
        let base = Url::parse(raw.trim()).map_err(|_| "invalid instance url".to_owned())?;
        let host = base.host_str().unwrap_or_default();
        let localhost = host == "127.0.0.1" || host == "localhost";
        if base.scheme() != "https" && !(base.scheme() == "http" && localhost) {
            return Err("instance url must be https (or http on localhost)".to_owned());
        }
        let restored = store.as_deref().and_then(load_remembered_session);
        Ok(Self {
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(20))
                .build()
                .map_err(|_| "unable to build http client".to_owned())?,
            base,
            session: Mutex::new(restored),
            session_store: store,
        })
    }

    pub fn origin(&self) -> String {
        let mut origin = format!(
            "{}://{}",
            self.base.scheme(),
            self.base.host_str().unwrap_or("")
        );
        if let Some(port) = self.base.port() {
            origin.push(':');
            origin.push_str(&port.to_string());
        }
        origin
    }

    pub fn clear_session(&self) {
        if let Ok(mut session) = self.session.lock() {
            *session = None;
        }
        forget_remembered_session(self.session_store.as_deref());
    }

    fn persist_current_session(&self) {
        let Some(path) = self.session_store.as_deref() else {
            return;
        };
        let Ok(guard) = self.session.lock() else {
            return;
        };
        if let Some(token) = guard.as_deref() {
            let _ = persist_remembered_session(path, token);
        }
    }

    fn cookie_header(&self) -> Option<String> {
        self.session
            .lock()
            .ok()
            .and_then(|session| session.clone())
            .map(|token| format!("session={token}"))
    }

    fn capture_session(&self, headers: &HeaderMap) {
        let Some(value) = headers
            .get(SET_COOKIE)
            .and_then(|value| value.to_str().ok())
        else {
            return;
        };
        let Some(token) = value
            .split(';')
            .next()
            .and_then(|part| part.strip_prefix("session="))
        else {
            return;
        };
        if token.is_empty() {
            self.clear_session();
            return;
        }
        if let Ok(mut session) = self.session.lock() {
            *session = Some(token.to_owned());
        }
    }

    fn headers(&self, json: bool, csrf: bool) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if json {
            headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        }
        if csrf && let Ok(origin) = HeaderValue::from_str(&self.origin()) {
            headers.insert(ORIGIN, origin);
        }
        if let Some(cookie) = self.cookie_header()
            && let Ok(value) = HeaderValue::from_str(&cookie)
        {
            headers.insert(COOKIE, value);
        }
        headers
    }

    fn join(&self, path: &str) -> Result<Url, String> {
        self.base
            .join(path.trim_start_matches('/'))
            .map_err(|_| "invalid instance url".to_owned())
    }

    async fn send(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&[u8]>,
        json: bool,
        csrf: bool,
    ) -> Result<reqwest::Response, String> {
        let url = self.join(path)?;
        let body = body.map(ToOwned::to_owned);
        for attempt in 0..4 {
            let mut request = self
                .client
                .request(method.clone(), url.clone())
                .headers(self.headers(json, csrf));
            if let Some(body) = body.as_deref() {
                request = request.body(body.to_owned());
            }
            match request.send().await {
                Ok(response) => {
                    self.capture_session(response.headers());
                    return Ok(response);
                }
                Err(_) if attempt < 3 => {
                    tokio::time::sleep(Duration::from_millis(150 * (attempt + 1))).await;
                }
                Err(_) => return Err("instance is unreachable".to_owned()),
            }
        }
        Err("instance is unreachable".to_owned())
    }

    async fn send_json<T: Serialize>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: &T,
        csrf: bool,
    ) -> Result<reqwest::Response, String> {
        let bytes = serde_json::to_vec(body).map_err(|_| "unable to encode request".to_owned())?;
        self.send(method, path, Some(&bytes), true, csrf).await
    }

    async fn relay(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&[u8]>,
        json: bool,
        csrf: bool,
    ) -> Result<SynapseResponse, String> {
        let response = self.send(method, path, body, json, csrf).await?;
        let status = response.status().as_u16();
        let bytes = response
            .bytes()
            .await
            .map_err(|_| "instance returned an invalid body".to_owned())?;
        let body = if bytes.is_empty() {
            None
        } else {
            Some(
                serde_json::from_slice(&bytes)
                    .map_err(|_| "instance returned an invalid body".to_owned())?,
            )
        };
        Ok(SynapseResponse { body, status })
    }

    async fn relay_json<T: Serialize>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: &T,
        csrf: bool,
    ) -> Result<SynapseResponse, String> {
        let bytes = serde_json::to_vec(body).map_err(|_| "unable to encode request".to_owned())?;
        self.relay(method, path, Some(&bytes), true, csrf).await
    }

    /// Execute the closed API contract used by the shared Vue client.
    ///
    /// Keeping this mapping here avoids granting the webview an arbitrary
    /// network primitive while preserving the web client's response semantics.
    pub async fn bridge_request(&self, request: SynapseRequest) -> Result<SynapseResponse, String> {
        match request {
            SynapseRequest::Session => {
                self.relay(reqwest::Method::GET, "v1/session", None, false, false)
                    .await
            }
            SynapseRequest::PublicSignup => {
                self.relay(reqwest::Method::GET, "auth/signup", None, false, false)
                    .await
            }
            SynapseRequest::Signup { body } => {
                self.relay_json(reqwest::Method::POST, "auth/signup", &body, false)
                    .await
            }
            SynapseRequest::Login { body } => {
                let remember = body.remember_device;
                let response = self
                    .relay_json(reqwest::Method::POST, "auth/login", &body, false)
                    .await?;
                if response.status == 204 {
                    if remember {
                        self.persist_current_session();
                    } else {
                        forget_remembered_session(self.session_store.as_deref());
                    }
                }
                Ok(response)
            }
            SynapseRequest::Logout => {
                let response = self
                    .relay(reqwest::Method::POST, "auth/logout", None, false, true)
                    .await;
                self.clear_session();
                response
            }
            SynapseRequest::ChangePassword { body } => {
                self.relay_json(reqwest::Method::POST, "auth/password", &body, true)
                    .await
            }
            SynapseRequest::Sessions => {
                self.relay(reqwest::Method::GET, "auth/sessions", None, false, false)
                    .await
            }
            SynapseRequest::RevokeOtherSessions => {
                self.relay(
                    reqwest::Method::POST,
                    "auth/sessions/revoke-others",
                    None,
                    false,
                    true,
                )
                .await
            }
            SynapseRequest::RevokeSession { session_id } => {
                if !is_uuid(&session_id) {
                    return Err("invalid session id".to_owned());
                }
                self.relay(
                    reqwest::Method::POST,
                    &format!("auth/sessions/{session_id}/revoke"),
                    None,
                    false,
                    true,
                )
                .await
            }
            SynapseRequest::DeleteAccount { body } => {
                let response = self
                    .relay_json(reqwest::Method::POST, "auth/account/delete", &body, true)
                    .await;
                self.clear_session();
                response
            }
            SynapseRequest::ListVaults => {
                self.relay(reqwest::Method::GET, "v1/vaults", None, false, false)
                    .await
            }
            SynapseRequest::CreateVault => {
                self.relay_json(
                    reqwest::Method::POST,
                    "vaults",
                    &serde_json::json!({}),
                    true,
                )
                .await
            }
            SynapseRequest::GetEnvelope { vault_id } => {
                validate_vault_id(&vault_id)?;
                self.relay(
                    reqwest::Method::GET,
                    &format!("v1/vaults/{vault_id}/envelope"),
                    None,
                    false,
                    false,
                )
                .await
            }
            SynapseRequest::PutEnvelope { vault_id, body } => {
                validate_vault_id(&vault_id)?;
                self.relay_json(
                    reqwest::Method::PUT,
                    &format!("v1/vaults/{vault_id}/envelope"),
                    &body,
                    true,
                )
                .await
            }
            SynapseRequest::Pull { vault_id, query } => {
                validate_vault_id(&vault_id)?;
                let request = pull_request(&vault_id, &query)?;
                let mut path = format!("v1/vaults/{vault_id}/operations?limit={}", request.limit);
                if let Some(cursor) = request.cursor {
                    path.push_str("&cursor=");
                    path.push_str(cursor.as_str());
                }
                self.relay(reqwest::Method::GET, &path, None, false, false)
                    .await
            }
            SynapseRequest::Push { vault_id, body } => {
                validate_vault_id(&vault_id)?;
                if body.vault_id != vault_id {
                    return Err("operation vault does not match request vault".to_owned());
                }
                self.relay_json(
                    reqwest::Method::POST,
                    &format!("v1/vaults/{vault_id}/operations"),
                    &body,
                    true,
                )
                .await
            }
        }
    }

    async fn parse_json<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, String> {
        if !response.status().is_success() {
            return Err("instance request failed".to_owned());
        }
        response
            .json()
            .await
            .map_err(|_| "instance returned an invalid body".to_owned())
    }

    pub async fn public_signup(&self) -> Result<bool, String> {
        let response = self
            .send(reqwest::Method::GET, "auth/signup", None, false, false)
            .await?;
        let body: serde_json::Value = Self::parse_json(response).await?;
        Ok(body.get("public_signup") == Some(&serde_json::Value::Bool(true)))
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<(), String> {
        let response = self
            .send_json(
                reqwest::Method::POST,
                "auth/login",
                &serde_json::json!({ "email": email, "password": password }),
                false,
            )
            .await?;
        if response.status() != StatusCode::NO_CONTENT && !response.status().is_success() {
            return Err("authentication failed".to_owned());
        }
        if self.cookie_header().is_none() {
            return Err("authentication failed".to_owned());
        }
        Ok(())
    }

    pub async fn signup(
        &self,
        email: &str,
        password: &str,
        invitation_token: Option<&str>,
    ) -> Result<(), String> {
        let mut body = serde_json::json!({ "email": email, "password": password });
        if let Some(token) = invitation_token.filter(|token| !token.is_empty()) {
            body["invitation_token"] = serde_json::Value::String(token.to_owned());
        }
        let response = self
            .send_json(reqwest::Method::POST, "auth/signup", &body, false)
            .await?;
        if !response.status().is_success() {
            return Err("registration failed".to_owned());
        }
        self.login(email, password).await
    }

    pub async fn logout(&self) -> Result<(), String> {
        let response = self
            .send(reqwest::Method::POST, "auth/logout", None, false, true)
            .await?;
        self.clear_session();
        if response.status() != StatusCode::NO_CONTENT && !response.status().is_success() {
            return Err("logout failed".to_owned());
        }
        Ok(())
    }

    pub async fn session(&self) -> Result<SessionInfo, String> {
        let response = self
            .send(reqwest::Method::GET, "v1/session", None, false, false)
            .await?;
        Self::parse_json(response).await
    }

    pub async fn change_password(
        &self,
        current_password: &str,
        new_password: &str,
    ) -> Result<(), String> {
        let response = self
            .send_json(
                reqwest::Method::POST,
                "auth/password",
                &serde_json::json!({
                    "current_password": current_password,
                    "new_password": new_password
                }),
                true,
            )
            .await?;
        if !response.status().is_success() {
            return Err("password change failed".to_owned());
        }
        Ok(())
    }

    pub async fn list_sessions(&self) -> Result<SessionList, String> {
        let response = self
            .send(reqwest::Method::GET, "auth/sessions", None, false, false)
            .await?;
        Self::parse_json(response).await
    }

    pub async fn revoke_session(&self, session_id: &str) -> Result<(), String> {
        let response = self
            .send(
                reqwest::Method::POST,
                &format!("auth/sessions/{session_id}/revoke"),
                None,
                false,
                true,
            )
            .await?;
        if !response.status().is_success() {
            return Err("unable to revoke session".to_owned());
        }
        Ok(())
    }

    pub async fn revoke_other_sessions(&self) -> Result<(), String> {
        let response = self
            .send(
                reqwest::Method::POST,
                "auth/sessions/revoke-others",
                None,
                false,
                true,
            )
            .await?;
        if !response.status().is_success() {
            return Err("unable to revoke sessions".to_owned());
        }
        Ok(())
    }

    pub async fn delete_account(&self, password: &str) -> Result<(), String> {
        let response = self
            .send_json(
                reqwest::Method::POST,
                "auth/account/delete",
                &serde_json::json!({ "password": password }),
                true,
            )
            .await?;
        self.clear_session();
        if !response.status().is_success() {
            return Err("account deletion failed".to_owned());
        }
        Ok(())
    }

    pub async fn list_vaults(&self) -> Result<Vec<String>, String> {
        let response = self
            .send(reqwest::Method::GET, "v1/vaults", None, false, false)
            .await?;
        let body: serde_json::Value = Self::parse_json(response).await?;
        Ok(body
            .get("vaults")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .filter_map(|value| value.get("id")?.as_str().map(ToOwned::to_owned))
            .collect())
    }

    pub async fn create_vault(&self) -> Result<String, String> {
        let response = self
            .send_json(
                reqwest::Method::POST,
                "vaults",
                &serde_json::json!({}),
                true,
            )
            .await?;
        if response.status() != StatusCode::CREATED && !response.status().is_success() {
            return Err("unable to create vault".to_owned());
        }
        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|_| "instance returned an invalid body".to_owned())?;
        body.get("id")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned)
            .ok_or_else(|| "unable to create vault".to_owned())
    }

    pub async fn get_envelope(&self, vault_id: &str) -> Result<Vec<u8>, String> {
        let response = self
            .send(
                reqwest::Method::GET,
                &format!("v1/vaults/{vault_id}/envelope"),
                None,
                false,
                false,
            )
            .await?;
        let body: serde_json::Value = Self::parse_json(response).await?;
        body.get("bytes")
            .and_then(|value| value.as_array())
            .map(|bytes| {
                bytes
                    .iter()
                    .filter_map(|value| value.as_u64().map(|byte| byte as u8))
                    .collect()
            })
            .filter(|bytes: &Vec<u8>| !bytes.is_empty())
            .ok_or_else(|| "unable to load vault envelope".to_owned())
    }

    pub async fn put_envelope(&self, vault_id: &str, bytes: &[u8]) -> Result<(), String> {
        let response = self
            .send_json(
                reqwest::Method::PUT,
                &format!("v1/vaults/{vault_id}/envelope"),
                &serde_json::json!({ "bytes": bytes }),
                true,
            )
            .await?;
        if response.status() != StatusCode::NO_CONTENT && !response.status().is_success() {
            return Err("unable to store vault envelope".to_owned());
        }
        Ok(())
    }

    pub async fn push(&self, operation: EncryptedPushOperation) -> Result<PushAck, TransportError> {
        let path = format!("v1/vaults/{}/operations", operation.vault_id);
        let body = serde_json::to_vec(&operation).map_err(|_| TransportError::Protocol)?;
        let response = self
            .send(reqwest::Method::POST, &path, Some(&body), true, true)
            .await
            .map_err(|_| TransportError::Network)?;
        match response.status() {
            StatusCode::CREATED | StatusCode::OK => {
                let ack: serde_json::Value = response
                    .json()
                    .await
                    .map_err(|_| TransportError::Protocol)?;
                let operation_id = ack
                    .get("operation_id")
                    .and_then(|value| value.as_str())
                    .ok_or(TransportError::Protocol)?;
                Ok(PushAck {
                    operation_id: operation_id.to_owned(),
                    revision: ack
                        .get("revision")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0),
                })
            }
            StatusCode::CONFLICT => {
                let conflict = response
                    .json::<Conflict>()
                    .await
                    .map_err(|_| TransportError::Protocol)?;
                Err(TransportError::Conflict(Box::new(conflict)))
            }
            status if status.is_server_error() => Err(TransportError::Network),
            _ => Err(TransportError::Protocol),
        }
    }

    pub async fn pull(&self, request: PullRequest) -> Result<PullOutcome, TransportError> {
        let mut url = format!(
            "v1/vaults/{}/operations?limit={}",
            request.vault_id, request.limit
        );
        if let Some(cursor) = request.cursor {
            url.push_str("&cursor=");
            url.push_str(cursor.as_str());
        }
        let response = self
            .send(reqwest::Method::GET, &url, None, false, false)
            .await
            .map_err(|_| TransportError::Network)?;
        match response.status() {
            StatusCode::OK => {
                let page: PullResponse = response
                    .json()
                    .await
                    .map_err(|_| TransportError::Protocol)?;
                Ok(PullOutcome::Page(page))
            }
            StatusCode::CONFLICT => Ok(PullOutcome::ResnapshotRequired),
            status if status.is_server_error() => Err(TransportError::Network),
            _ => Err(TransportError::Protocol),
        }
    }
}

fn validate_vault_id(vault_id: &str) -> Result<(), String> {
    if VaultId::parse(vault_id).is_err() {
        return Err("invalid vault id".to_owned());
    }
    Ok(())
}

fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && [8, 13, 18, 23]
            .into_iter()
            .all(|index| bytes[index] == b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit())
}

fn pull_request(vault_id: &str, query: &str) -> Result<PullRequest, String> {
    let query = query.trim_start_matches('?');
    let mut cursor = None;
    let mut limit = None;
    for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
        match key.as_ref() {
            "cursor" if cursor.is_none() => {
                cursor = Some(
                    SyncCursor::new(value.into_owned())
                        .map_err(|_| "invalid sync cursor".to_owned())?,
                );
            }
            "limit" if limit.is_none() => {
                limit = Some(
                    value
                        .parse::<u32>()
                        .map_err(|_| "invalid pull limit".to_owned())?,
                );
            }
            _ => return Err("invalid pull query".to_owned()),
        }
    }
    let limit = limit.ok_or_else(|| "missing pull limit".to_owned())?;
    serde_json::from_value(serde_json::json!({
        "protocol_version": 1,
        "vault_id": vault_id,
        "cursor": cursor,
        "limit": limit,
    }))
    .map_err(|_| "invalid pull request".to_owned())
}

pub fn parse_session_cookie(set_cookie: &str) -> Option<&str> {
    set_cookie
        .split(';')
        .next()
        .and_then(|part| part.strip_prefix("session="))
        .filter(|token| !token.is_empty())
}

fn opaque_session_token(value: &str) -> bool {
    let trimmed = value.trim();
    (16..=128).contains(&trimmed.len())
        && trimmed
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

fn persist_remembered_session(path: &Path, token: &str) -> Result<(), String> {
    if !opaque_session_token(token) {
        return Err("invalid session token".to_owned());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "unable to persist session".to_owned())?;
    }
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|_| "unable to persist session".to_owned())?;
        file.write_all(token.as_bytes())
            .map_err(|_| "unable to persist session".to_owned())?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, token).map_err(|_| "unable to persist session".to_owned())?;
    }
    Ok(())
}

fn load_remembered_session(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let token = String::from_utf8(bytes).ok()?;
    let token = token.trim();
    if !opaque_session_token(token) {
        forget_remembered_session(Some(path));
        return None;
    }
    Some(token.to_owned())
}

fn forget_remembered_session(path: Option<&Path>) {
    if let Some(path) = path {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        InstanceClient, forget_remembered_session, load_remembered_session, parse_session_cookie,
        persist_remembered_session,
    };

    #[test]
    fn session_cookie_parser_keeps_only_the_opaque_token() {
        assert_eq!(
            parse_session_cookie("session=opaque-token; Path=/; HttpOnly; SameSite=Strict"),
            Some("opaque-token")
        );
        assert_eq!(
            parse_session_cookie("session=; Path=/; HttpOnly; Max-Age=0"),
            None
        );
    }

    #[test]
    fn remembered_native_session_survives_a_new_client() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("remembered-session");
        persist_remembered_session(&path, "opaque-session-token").expect("persist");
        let client =
            InstanceClient::connect_with_session_store("http://127.0.0.1:3000", Some(path.clone()))
                .expect("client");
        assert_eq!(
            client.cookie_header(),
            Some("session=opaque-session-token".to_owned())
        );
        client.clear_session();
        assert!(load_remembered_session(&path).is_none());
        assert!(!path.exists());
    }

    #[test]
    fn forgetting_the_device_removes_the_native_session_file() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("remembered-session");
        persist_remembered_session(&path, "opaque-session-token").expect("persist");
        forget_remembered_session(Some(&path));
        assert!(!path.exists());
        let client =
            InstanceClient::connect_with_session_store("http://127.0.0.1:3000", Some(path))
                .expect("client");
        assert_eq!(client.cookie_header(), None);
    }

    #[test]
    fn remembered_session_file_is_not_world_readable() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("remembered-session");
        persist_remembered_session(&path, "opaque-session-token").expect("persist");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path)
                .expect("metadata")
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let stored = std::fs::read_to_string(&path).expect("file");
        assert_eq!(stored, "opaque-session-token");
        assert!(!stored.contains("vault"));
    }
}
