use std::sync::{Arc, Mutex};

use tauri::State;

use crate::http::{InstanceClient, SynapseRequest, SynapseResponse};

/// Native boundary for the shared web client.
///
/// The webview has no filesystem or arbitrary HTTP permission.  It can only
/// configure one validated Synapse instance and invoke the closed request enum
/// from `http.rs`; the session cookie remains in this process.
pub struct VaultCommands {
    http: Mutex<Option<Arc<InstanceClient>>>,
}

impl VaultCommands {
    pub fn new() -> Self {
        Self {
            http: Mutex::new(None),
        }
    }

    fn http_client(&self) -> Result<Arc<InstanceClient>, String> {
        self.http
            .lock()
            .map_err(|_| "instance client is unavailable".to_owned())?
            .clone()
            .ok_or_else(|| "instance url is not configured".to_owned())
    }

    pub fn set_instance_url(&self, url: String) -> Result<String, String> {
        let client = InstanceClient::connect(&url)?;
        let origin = client.origin();
        *self
            .http
            .lock()
            .map_err(|_| "instance client is unavailable".to_owned())? = Some(Arc::new(client));
        Ok(origin)
    }

    pub async fn synapse_request(
        &self,
        request: SynapseRequest,
    ) -> Result<SynapseResponse, String> {
        self.http_client()?.bridge_request(request).await
    }
}

impl Default for VaultCommands {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub fn set_instance_url(url: String, commands: State<'_, VaultCommands>) -> Result<String, String> {
    commands.set_instance_url(url)
}

#[tauri::command]
pub async fn synapse_request(
    request: SynapseRequest,
    commands: State<'_, VaultCommands>,
) -> Result<SynapseResponse, String> {
    commands.synapse_request(request).await
}
