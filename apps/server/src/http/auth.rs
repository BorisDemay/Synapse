use axum::{
    Json,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{
        mail::{MailError, MailMessage, Mailer},
        password, session,
    },
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignupRequest {
    email: String,
    password: String,
    invitation_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivateRequest {
    token: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginRequest {
    email: String,
    password: String,
    #[serde(default)]
    remember_device: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangePasswordRequest {
    current_password: String,
    new_password: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeleteAccountRequest {
    password: String,
}

#[derive(Serialize)]
pub struct SessionResponse {
    user_id: String,
}

#[derive(Serialize)]
pub struct SessionListItem {
    created_at: String,
    current: bool,
    id: String,
}

#[derive(Serialize)]
pub struct SessionListResponse {
    email: String,
    sessions: Vec<SessionListItem>,
}

#[derive(Serialize)]
pub struct SignupStatusResponse {
    public_signup: bool,
}

pub(crate) fn normalized_email(email: &str) -> Option<String> {
    let email = email.trim().to_lowercase();
    (email.len() <= 320 && email.contains('@') && !email.starts_with('@') && !email.ends_with('@'))
        .then_some(email)
}

fn normalized_login(identifier: &str) -> Option<String> {
    let identifier = identifier.trim().to_lowercase();
    if identifier.contains('@') {
        return normalized_email(&identifier);
    }
    let valid_local = (1..=64).contains(&identifier.len())
        && identifier.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
        && identifier
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphanumeric());
    valid_local.then_some(identifier)
}

fn opaque_hash(value: &str) -> Vec<u8> {
    Sha256::digest(value.as_bytes()).to_vec()
}

fn csrf_origin_allowed(headers: &HeaderMap, allowed_origins: &[String]) -> bool {
    headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|origin| crate::http::security::origin_allowed(allowed_origins, origin))
}

fn authenticated_user<'a>(
    headers: &'a HeaderMap,
    state: &'a AppState,
) -> Result<(&'a sqlx::PgPool, session::SessionToken), StatusCode> {
    let pool = state.pool.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let token = crate::http::vaults::session_token(headers).ok_or(StatusCode::UNAUTHORIZED)?;
    Ok((pool, token))
}

fn signup_error() -> StatusCode {
    StatusCode::BAD_REQUEST
}

fn password_hash_status(error: password::PasswordError) -> StatusCode {
    match error {
        password::PasswordError::Invalid => StatusCode::BAD_REQUEST,
        password::PasswordError::Busy | password::PasswordError::Hashing => {
            StatusCode::SERVICE_UNAVAILABLE
        }
    }
}

pub async fn signup_status(State(state): State<AppState>) -> Json<SignupStatusResponse> {
    Json(SignupStatusResponse {
        public_signup: state.allow_public_signup,
    })
}

pub async fn signup(
    State(state): State<AppState>,
    Json(request): Json<SignupRequest>,
) -> StatusCode {
    let Some(pool) = state.pool.clone() else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let Some(email) = normalized_email(&request.email) else {
        return signup_error();
    };
    if !state.allow_public_signup {
        let Some(invitation_token) = request.invitation_token.as_deref() else {
            return signup_error();
        };
        let eligible = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM invites WHERE token_hash = $1 AND lower(email) = $2 AND accepted_at IS NULL AND expires_at > CURRENT_TIMESTAMP)",
        )
            .bind(opaque_hash(invitation_token))
            .bind(&email)
            .fetch_one(&pool)
            .await;
        if !matches!(eligible, Ok(true)) {
            return signup_error();
        }
    }
    let password_hash = match password::hash_async(request.password.clone()).await {
        Ok(hash) => hash,
        Err(error) => return password_hash_status(error),
    };

    let mut transaction = match pool.begin().await {
        Ok(transaction) => transaction,
        Err(_) => return signup_error(),
    };
    if !state.allow_public_signup {
        let Some(invitation_token) = request.invitation_token else {
            return signup_error();
        };
        let invitation = sqlx::query_scalar::<_, String>("UPDATE invites SET accepted_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND lower(email) = $2 AND accepted_at IS NULL AND expires_at > CURRENT_TIMESTAMP RETURNING id::text")
            .bind(opaque_hash(&invitation_token))
            .bind(&email)
            .fetch_optional(&mut *transaction)
            .await;
        let Ok(Some(_)) = invitation else {
            return signup_error();
        };
    }
    let user_id = Uuid::new_v4();
    let created = sqlx::query(
        "INSERT INTO users (id, email, password_hash, activated_at) VALUES ($1::uuid, $2, $3, NULL)",
    )
    .bind(user_id.to_string())
    .bind(&email)
    .bind(password_hash.as_bytes())
    .execute(&mut *transaction)
    .await;
    if created.is_err() {
        return signup_error();
    }
    let activation_token = random_token();
    let stored = sqlx::query("INSERT INTO account_activations (id, user_id, token_hash, expires_at) VALUES ($1::uuid, $2::uuid, $3, CURRENT_TIMESTAMP + INTERVAL '24 hours')")
        .bind(Uuid::new_v4().to_string())
        .bind(user_id.to_string())
        .bind(opaque_hash(&activation_token))
        .execute(&mut *transaction)
        .await;
    if stored.is_err() {
        return signup_error();
    }
    if send_activation_mail(
        state.mailer.as_ref(),
        &state.public_origin,
        &email,
        &activation_token,
    )
    .await
    .is_err()
    {
        return StatusCode::SERVICE_UNAVAILABLE;
    }
    if transaction.commit().await.is_err() {
        return signup_error();
    }

    StatusCode::CREATED
}

pub async fn activate(
    State(state): State<AppState>,
    Json(request): Json<ActivateRequest>,
) -> StatusCode {
    let Some(pool) = state.pool else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    if request.token.is_empty() {
        return StatusCode::BAD_REQUEST;
    }
    let mut transaction = match pool.begin().await {
        Ok(transaction) => transaction,
        Err(_) => return StatusCode::BAD_REQUEST,
    };
    let user_id = sqlx::query_scalar::<_, String>(
        "UPDATE account_activations SET consumed_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP RETURNING user_id::text",
    )
    .bind(opaque_hash(&request.token))
    .fetch_optional(&mut *transaction)
    .await;
    let Ok(Some(user_id)) = user_id else {
        return StatusCode::BAD_REQUEST;
    };
    if sqlx::query(
        "UPDATE users SET activated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid AND activated_at IS NULL",
    )
    .bind(user_id)
    .execute(&mut *transaction)
    .await
    .is_err()
    {
        return StatusCode::BAD_REQUEST;
    }
    if transaction.commit().await.is_err() {
        return StatusCode::BAD_REQUEST;
    }
    StatusCode::NO_CONTENT
}

pub async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.pool else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Some(email) = normalized_login(&request.email) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let user = sqlx::query(
        "SELECT id::text AS id, password_hash, (activated_at IS NOT NULL) AS activated FROM users WHERE email = $1",
    )
        .bind(email)
        .fetch_optional(&pool)
        .await;
    let Ok(Some(user)) = user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(user_id) = Uuid::parse_str(&user.get::<String, _>("id")) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(hash) = String::from_utf8(user.get::<Vec<u8>, _>("password_hash")) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    match password::verify_async(request.password.clone(), hash.clone()).await {
        Ok(()) => {}
        Err(password::PasswordError::Busy | password::PasswordError::Hashing) => {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
        Err(password::PasswordError::Invalid) => {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    }
    if !user.get::<bool, _>("activated") {
        return StatusCode::FORBIDDEN.into_response();
    }
    let lifetime = if request.remember_device {
        session::SessionLifetime::Remembered
    } else {
        session::SessionLifetime::Standard
    };
    let mut transaction = match pool.begin().await {
        Ok(transaction) => transaction,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let current = sqlx::query(
        "SELECT password_hash, (activated_at IS NOT NULL) AS activated FROM users WHERE id = $1::uuid FOR UPDATE",
    )
    .bind(user_id.to_string())
    .fetch_optional(&mut *transaction)
    .await;
    let Ok(Some(current)) = current else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let current_hash = current.get::<Vec<u8>, _>("password_hash");
    if current_hash != hash.as_bytes() || !current.get::<bool, _>("activated") {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(token) = session::create_with_lifetime_in_transaction(
        &mut transaction,
        user_id,
        state.clock.now(),
        lifetime,
    )
    .await
    else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    if transaction.commit().await.is_err() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    session_cookie_response(
        StatusCode::NO_CONTENT,
        Some(&token),
        state.cookie_secure,
        lifetime.max_age_secs(),
    )
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !csrf_origin_allowed(&headers, &state.allowed_origins) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let (pool, token) = match authenticated_user(&headers, &state) {
        Ok(value) => value,
        Err(status) => return status.into_response(),
    };
    match session::user_for(pool, &token, state.clock.now()).await {
        Ok(Some(_)) => {}
        Ok(None) => return StatusCode::UNAUTHORIZED.into_response(),
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
    match session::revoke(pool, &token).await {
        Ok(()) => {
            state.notifications.revoke_session(&token);
            session_cookie_response(StatusCode::NO_CONTENT, None, state.cookie_secure, 0)
        }
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

pub async fn session_info(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SessionResponse>, StatusCode> {
    let pool = state.pool.ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let token = crate::http::vaults::session_token(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id = session::user_for(&pool, &token, state.clock.now())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    Ok(Json(SessionResponse {
        user_id: user_id.to_string(),
    }))
}

pub async fn list_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SessionListResponse>, StatusCode> {
    let (pool, token) = authenticated_user(&headers, &state)?;
    let user_id = session::user_for(pool, &token, state.clock.now())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let email = sqlx::query_scalar::<_, String>("SELECT email FROM users WHERE id = $1::uuid")
        .bind(user_id.to_string())
        .fetch_optional(pool)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let sessions = session::list_for_user(pool, user_id, &token, state.clock.now())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(Json(SessionListResponse {
        email,
        sessions: sessions
            .into_iter()
            .map(|item| SessionListItem {
                created_at: item.created_at,
                current: item.current,
                id: item.id,
            })
            .collect(),
    }))
}

pub async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ChangePasswordRequest>,
) -> StatusCode {
    if !csrf_origin_allowed(&headers, &state.allowed_origins) {
        return StatusCode::FORBIDDEN;
    }
    let (pool, token) = match authenticated_user(&headers, &state) {
        Ok(value) => value,
        Err(status) => return status,
    };
    let user_id = match session::user_for(pool, &token, state.clock.now()).await {
        Ok(Some(id)) => id,
        Ok(None) => return StatusCode::UNAUTHORIZED,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE,
    };
    if request.current_password == request.new_password {
        return StatusCode::BAD_REQUEST;
    }
    let stored =
        sqlx::query_scalar::<_, Vec<u8>>("SELECT password_hash FROM users WHERE id = $1::uuid")
            .bind(user_id.to_string())
            .fetch_optional(pool)
            .await;
    let Ok(Some(stored)) = stored else {
        return StatusCode::UNAUTHORIZED;
    };
    let Ok(hash) = String::from_utf8(stored) else {
        return StatusCode::UNAUTHORIZED;
    };
    match password::verify_async(request.current_password.clone(), hash.clone()).await {
        Ok(()) => {}
        Err(password::PasswordError::Busy | password::PasswordError::Hashing) => {
            return StatusCode::SERVICE_UNAVAILABLE;
        }
        Err(password::PasswordError::Invalid) => return StatusCode::UNAUTHORIZED,
    }
    let new_hash = match password::hash_async(request.new_password.clone()).await {
        Ok(hash) => hash,
        Err(error) => return password_hash_status(error),
    };
    let mut transaction = match pool.begin().await {
        Ok(transaction) => transaction,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE,
    };
    let locked = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT password_hash FROM users WHERE id = $1::uuid FOR UPDATE",
    )
    .bind(user_id.to_string())
    .fetch_optional(&mut *transaction)
    .await;
    let Ok(Some(locked)) = locked else {
        return StatusCode::UNAUTHORIZED;
    };
    if locked != hash.as_bytes() {
        return StatusCode::UNAUTHORIZED;
    }
    if sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2::uuid")
        .bind(new_hash.as_bytes())
        .bind(user_id.to_string())
        .execute(&mut *transaction)
        .await
        .is_err()
    {
        return StatusCode::SERVICE_UNAVAILABLE;
    }
    if session::revoke_others_in_transaction(&mut transaction, user_id, &token)
        .await
        .is_err()
    {
        return StatusCode::SERVICE_UNAVAILABLE;
    }
    if transaction.commit().await.is_err() {
        return StatusCode::SERVICE_UNAVAILABLE;
    }
    state.notifications.revoke_user_except(user_id, &token);
    StatusCode::NO_CONTENT
}

pub async fn revoke_other_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> StatusCode {
    if !csrf_origin_allowed(&headers, &state.allowed_origins) {
        return StatusCode::FORBIDDEN;
    }
    let (pool, token) = match authenticated_user(&headers, &state) {
        Ok(value) => value,
        Err(status) => return status,
    };
    let user_id = match session::user_for(pool, &token, state.clock.now()).await {
        Ok(Some(id)) => id,
        Ok(None) => return StatusCode::UNAUTHORIZED,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE,
    };
    match session::revoke_others(pool, user_id, &token).await {
        Ok(()) => {
            state.notifications.revoke_user_except(user_id, &token);
            StatusCode::NO_CONTENT
        }
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}

pub async fn revoke_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> StatusCode {
    if !csrf_origin_allowed(&headers, &state.allowed_origins) {
        return StatusCode::FORBIDDEN;
    }
    let Ok(session_id) = Uuid::parse_str(&session_id) else {
        return StatusCode::BAD_REQUEST;
    };
    let (pool, token) = match authenticated_user(&headers, &state) {
        Ok(value) => value,
        Err(status) => return status,
    };
    let user_id = match session::user_for(pool, &token, state.clock.now()).await {
        Ok(Some(id)) => id,
        Ok(None) => return StatusCode::UNAUTHORIZED,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE,
    };
    match session::revoke_id(pool, user_id, session_id).await {
        Ok(Some(token_hash)) => {
            state.notifications.revoke_token_hash(token_hash);
            StatusCode::NO_CONTENT
        }
        Ok(None) => StatusCode::NOT_FOUND,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}

pub async fn delete_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<DeleteAccountRequest>,
) -> StatusCode {
    if !csrf_origin_allowed(&headers, &state.allowed_origins) {
        return StatusCode::FORBIDDEN;
    }
    let (pool, token) = match authenticated_user(&headers, &state) {
        Ok(value) => value,
        Err(status) => return status,
    };
    let user_id = match session::user_for(pool, &token, state.clock.now()).await {
        Ok(Some(id)) => id,
        Ok(None) => return StatusCode::UNAUTHORIZED,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE,
    };
    let stored =
        sqlx::query_scalar::<_, Vec<u8>>("SELECT password_hash FROM users WHERE id = $1::uuid")
            .bind(user_id.to_string())
            .fetch_optional(pool)
            .await;
    let Ok(Some(stored)) = stored else {
        return StatusCode::UNAUTHORIZED;
    };
    let Ok(hash) = String::from_utf8(stored) else {
        return StatusCode::UNAUTHORIZED;
    };
    match password::verify_async(request.password.clone(), hash).await {
        Ok(()) => {}
        Err(password::PasswordError::Busy | password::PasswordError::Hashing) => {
            return StatusCode::SERVICE_UNAVAILABLE;
        }
        Err(password::PasswordError::Invalid) => return StatusCode::UNAUTHORIZED,
    }
    match session::delete_account(pool, user_id).await {
        Ok(()) => {
            state.notifications.revoke_user(user_id);
            StatusCode::NO_CONTENT
        }
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}

fn session_cookie_response(
    status: StatusCode,
    token: Option<&session::SessionToken>,
    cookie_secure: bool,
    max_age: u64,
) -> axum::response::Response {
    let secure = if cookie_secure { "; Secure" } else { "" };
    let value = match token {
        Some(token) => format!(
            "session={}; Path=/; HttpOnly{secure}; SameSite=Strict; Max-Age={max_age}",
            token.cookie_value()
        ),
        None => format!("session=; Path=/; HttpOnly{secure}; SameSite=Strict; Max-Age=0"),
    };
    let mut response = status.into_response();
    if let Ok(cookie) = HeaderValue::from_str(&value) {
        response.headers_mut().insert(header::SET_COOKIE, cookie);
    }
    response
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

async fn send_activation_mail(
    mailer: &dyn Mailer,
    public_origin: &str,
    email: &str,
    token: &str,
) -> Result<(), MailError> {
    let origin = public_origin.trim_end_matches('/');
    mailer
        .send(MailMessage {
            to: email.to_owned(),
            subject: "Activate your Synapse account".to_owned(),
            body: format!(
                "Open this link to activate your account:\n{origin}/activate?token={token}\n"
            ),
        })
        .await
}
