use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::http::{InstanceClient, SynapseRequest, SynapseResponse};
use crate::local_folder::{FolderEntry, LocalFolderMirror, default_folder_path};

/// Native boundary for the shared web client.
///
/// The webview has no filesystem or arbitrary HTTP permission.  It can only
/// configure one validated Synapse instance and invoke the closed request enum
/// from `http.rs`. The session cookie stays in Rust; a remembered device may
/// persist that opaque token in the application data directory, never in Vue.
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

    pub fn instance_origin(&self) -> Result<String, String> {
        self.http_client().map(|client| client.origin())
    }

    pub fn set_instance_url(&self, url: String) -> Result<String, String> {
        self.set_instance_url_with_session_store(url, None)
    }

    pub fn set_instance_url_with_session_store(
        &self,
        url: String,
        store: Option<PathBuf>,
    ) -> Result<String, String> {
        let client = InstanceClient::connect_with_session_store(&url, store)?;
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
pub fn set_instance_url(
    url: String,
    commands: State<'_, VaultCommands>,
    app: AppHandle,
) -> Result<String, String> {
    let store = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("remembered-session"));
    commands.set_instance_url_with_session_store(url, store)
}

#[tauri::command]
pub async fn synapse_request(
    request: SynapseRequest,
    commands: State<'_, VaultCommands>,
) -> Result<SynapseResponse, String> {
    commands.synapse_request(request).await
}

#[derive(Default, Deserialize, Serialize)]
struct FolderConfigFile {
    roots: BTreeMap<String, String>,
}

#[derive(Default)]
pub struct LocalFolderRegistry {
    writes: tokio::sync::Mutex<()>,
}

impl LocalFolderRegistry {
    pub fn new() -> Self {
        Self::default()
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|_| "local folder is unavailable")?;
    Ok(dir.join("local-folders.json"))
}

fn load_config(app: &AppHandle) -> FolderConfigFile {
    let path = match config_path(app) {
        Ok(path) => path,
        Err(_) => return FolderConfigFile::default(),
    };
    std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, config: &FolderConfigFile) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "local folder is unavailable")?;
    }
    let bytes = serde_json::to_vec(config).map_err(|_| "local folder is unavailable")?;
    use std::io::Write;
    let temporary = path.with_extension(format!("{}.pending", synapse_core::VaultId::new()));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "local folder is unavailable")?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|_| "local folder is unavailable")?;
    drop(file);
    std::fs::rename(&temporary, &path).map_err(|_| "local folder is unavailable")?;
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        std::fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| "local folder is unavailable")?;
    }
    Ok(())
}

fn default_root(app: &AppHandle, vault_id: &str) -> Result<PathBuf, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|_| "local folder is unavailable")?;
    default_folder_path(&base, vault_id)
}

fn persist_root(app: &AppHandle, vault_id: &str, root: &std::path::Path) -> Result<(), String> {
    let mut config = load_config(app);
    config
        .roots
        .insert(vault_id.to_owned(), root.to_string_lossy().into_owned());
    save_config(app, &config)
}

fn resolve_root(app: &AppHandle, vault_id: &str) -> Result<PathBuf, String> {
    if let Some(stored) = load_config(app).roots.get(vault_id) {
        return Ok(PathBuf::from(stored));
    }
    default_root(app, vault_id)
}

#[tauri::command]
pub async fn ensure_local_vault_folder(
    vault_id: String,
    app: AppHandle,
    registry: State<'_, LocalFolderRegistry>,
) -> Result<String, String> {
    let _guard = registry.writes.lock().await;
    let root = resolve_root(&app, &vault_id)?;
    let mirror = LocalFolderMirror::open_for_vault(root, &vault_id).await?;
    mirror.claim_selection().await?;
    persist_root(&app, &vault_id, &mirror.root())?;
    Ok(mirror.root().to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn mirror_local_vault_folder(
    vault_id: String,
    entries: Vec<FolderEntry>,
    app: AppHandle,
    registry: State<'_, LocalFolderRegistry>,
) -> Result<String, String> {
    let _guard = registry.writes.lock().await;
    let root = resolve_root(&app, &vault_id)?;
    let mut mirror = LocalFolderMirror::open_for_vault(root, &vault_id).await?;
    mirror.replace_snapshot(&entries).await?;
    persist_root(&app, &vault_id, &mirror.root())?;
    Ok(mirror.root().to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn choose_local_vault_folder(
    vault_id: Option<String>,
    app: AppHandle,
    registry: State<'_, LocalFolderRegistry>,
) -> Result<Option<String>, String> {
    if let Some(id) = &vault_id {
        synapse_core::VaultId::parse(id).map_err(|_| "invalid vault path")?;
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choisir un dossier de coffre Synapse")
        .pick_folder(move |path| {
            let _ = sender.send(path);
        });
    let Some(path) = receiver.await.map_err(|_| "folder selection failed")? else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| "invalid vault path")?;
    let path = path.to_str().ok_or("invalid vault path")?.to_owned();
    if let Some(vault_id) = vault_id {
        return bind_local_vault_folder(vault_id, path, app, registry)
            .await
            .map(Some);
    }
    Ok(Some(path))
}

#[tauri::command]
pub async fn bind_local_vault_folder(
    vault_id: String,
    path: String,
    app: AppHandle,
    registry: State<'_, LocalFolderRegistry>,
) -> Result<String, String> {
    let _guard = registry.writes.lock().await;
    synapse_core::VaultId::parse(&vault_id).map_err(|_| "invalid vault path")?;
    let root = PathBuf::from(path);
    let mirror = LocalFolderMirror::open_for_vault(root, &vault_id).await?;
    mirror.claim_selection().await?;
    persist_root(&app, &vault_id, &mirror.root())?;
    Ok(mirror.root().to_string_lossy().into_owned())
}
