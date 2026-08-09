use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
};

use serde::Serialize;
use synapse_core::{VaultPath, VaultService};
use synapse_sync::{
    client::SyncTransport,
    engine::{Backoff, SyncEngine, SyncState},
};
use tauri::State;
use tokio::sync::Mutex;

pub trait VaultDialog: Send + Sync + 'static {
    fn pick_vault(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Option<PathBuf>, String>> + Send + '_>>;
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedVault {
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub path: String,
    pub label: String,
}

/// Content-free state returned by an explicitly injected sync adapter.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub state: &'static str,
}

/// Desktop adapter for a configured engine. No transport/client is created
/// globally, so network credentials and endpoints remain explicit.
pub struct SyncCommands<T, B> {
    engine: Mutex<SyncEngine<T, B>>,
}

impl<T, B> SyncCommands<T, B>
where
    T: SyncTransport + Send,
    B: Backoff + Send,
{
    pub fn new(engine: SyncEngine<T, B>) -> Self {
        Self {
            engine: Mutex::new(engine),
        }
    }

    pub async fn synchronize_queued_operations(&self) -> Result<SyncStatus, String> {
        let state = self
            .engine
            .lock()
            .await
            .synchronize()
            .map_err(|_| "unable to synchronize queued operations".to_owned())?;
        Ok(SyncStatus {
            state: match state {
                SyncState::Synced => "synced",
                SyncState::Pending => "pending",
                SyncState::Conflict => "conflict",
            },
        })
    }
}

struct ActiveVault {
    root: PathBuf,
    service: VaultService,
}

pub struct VaultCommands<D> {
    dialog: D,
    active_vault: Mutex<Option<ActiveVault>>,
}

impl<D: VaultDialog> VaultCommands<D> {
    pub fn new(dialog: D) -> Self {
        Self {
            dialog,
            active_vault: Mutex::new(None),
        }
    }

    pub async fn open_vault(&self) -> Result<Option<OpenedVault>, String> {
        let Some(root) = self.dialog.pick_vault().await? else {
            return Ok(None);
        };
        let service = VaultService::open(&root)
            .await
            .map_err(|_| "unable to open the selected vault".to_owned())?;
        let name = root
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "selected vault has no valid name".to_owned())?
            .to_owned();

        *self.active_vault.lock().await = Some(ActiveVault { root, service });
        Ok(Some(OpenedVault { name }))
    }

    pub async fn list_notes(&self) -> Result<Vec<NoteSummary>, String> {
        let vault = self.active_vault.lock().await;
        let vault = vault
            .as_ref()
            .ok_or_else(|| "no vault is open".to_owned())?;
        collect_notes(&vault.root).await
    }

    pub async fn read_note(&self, path: String) -> Result<String, String> {
        let path = parse_path(&path)?;
        let vault = self.active_vault.lock().await;
        let vault = vault
            .as_ref()
            .ok_or_else(|| "no vault is open".to_owned())?;
        vault
            .service
            .read_note(&path)
            .await
            .map_err(|_| "unable to read vault note".to_owned())
    }

    pub async fn write_note(&self, path: String, content: String) -> Result<(), String> {
        let path = parse_path(&path)?;
        let vault = self.active_vault.lock().await;
        let vault = vault
            .as_ref()
            .ok_or_else(|| "no vault is open".to_owned())?;
        vault
            .service
            .create_note(&path, &content)
            .await
            .map_err(|_| "unable to write vault note".to_owned())
    }

    pub async fn rename_note(&self, source: String, destination: String) -> Result<(), String> {
        let source = parse_path(&source)?;
        let destination = parse_path(&destination)?;
        let vault = self.active_vault.lock().await;
        let vault = vault
            .as_ref()
            .ok_or_else(|| "no vault is open".to_owned())?;
        vault
            .service
            .rename_note(&source, &destination)
            .await
            .map_err(|_| "unable to rename vault note".to_owned())
    }

    pub async fn trash_note(&self, path: String) -> Result<(), String> {
        let path = parse_path(&path)?;
        let vault = self.active_vault.lock().await;
        let vault = vault
            .as_ref()
            .ok_or_else(|| "no vault is open".to_owned())?;
        vault
            .service
            .delete_note(&path)
            .await
            .map_err(|_| "unable to trash vault note".to_owned())
    }

    pub async fn search_notes(&self, query: String) -> Result<Vec<NoteSummary>, String> {
        let normalized_query = query.to_lowercase();
        if normalized_query.is_empty() {
            return Ok(Vec::new());
        }

        let vault = self.active_vault.lock().await;
        let vault = vault
            .as_ref()
            .ok_or_else(|| "no vault is open".to_owned())?;
        let notes = collect_notes(&vault.root).await?;
        let mut matches = Vec::new();

        for note in notes {
            let path = parse_path(&note.path)?;
            let content = vault
                .service
                .read_note(&path)
                .await
                .map_err(|_| "unable to search vault notes".to_owned())?;
            if content.to_lowercase().contains(&normalized_query) {
                matches.push(note);
            }
        }

        Ok(matches)
    }
}

fn parse_path(path: &str) -> Result<VaultPath, String> {
    VaultPath::parse(path).map_err(|_| "invalid vault note path".to_owned())
}

async fn collect_notes(root: &Path) -> Result<Vec<NoteSummary>, String> {
    let mut directories = vec![root.to_path_buf()];
    let mut notes = Vec::new();

    while let Some(directory) = directories.pop() {
        let mut entries = tokio::fs::read_dir(&directory)
            .await
            .map_err(|_| "unable to list vault notes".to_owned())?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|_| "unable to list vault notes".to_owned())?
        {
            let file_type = entry
                .file_type()
                .await
                .map_err(|_| "unable to list vault notes".to_owned())?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if entry.file_name() != ".synapse-trash" {
                    directories.push(entry.path());
                }
                continue;
            }
            if !file_type.is_file()
                || entry.path().extension().and_then(|value| value.to_str()) != Some("md")
            {
                continue;
            }

            let relative = entry
                .path()
                .strip_prefix(root)
                .map_err(|_| "unable to list vault notes".to_owned())?
                .to_string_lossy()
                .replace('\\', "/");
            let path = parse_path(&relative)?;
            let label = entry.file_name().to_string_lossy().to_string();
            notes.push(NoteSummary {
                path: path.as_str().to_owned(),
                label,
            });
        }
    }

    notes.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(notes)
}

pub struct TauriDialog {
    app: tauri::AppHandle,
}

impl TauriDialog {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl VaultDialog for TauriDialog {
    fn pick_vault(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Option<PathBuf>, String>> + Send + '_>> {
        Box::pin(async move {
            use tauri_plugin_dialog::DialogExt;

            let (sender, receiver) = tokio::sync::oneshot::channel();
            self.app.dialog().file().pick_folder(move |selected| {
                let selected = selected.and_then(|path| path.into_path().ok());
                let _ = sender.send(selected);
            });
            receiver
                .await
                .map_err(|_| "vault picker closed unexpectedly".to_owned())
        })
    }
}

#[tauri::command]
pub async fn open_vault(
    commands: State<'_, VaultCommands<TauriDialog>>,
) -> Result<Option<OpenedVault>, String> {
    commands.open_vault().await
}

#[tauri::command]
pub async fn list_notes(
    commands: State<'_, VaultCommands<TauriDialog>>,
) -> Result<Vec<NoteSummary>, String> {
    commands.list_notes().await
}

#[tauri::command]
pub async fn read_note(
    path: String,
    commands: State<'_, VaultCommands<TauriDialog>>,
) -> Result<String, String> {
    commands.read_note(path).await
}

#[tauri::command]
pub async fn write_note(
    path: String,
    content: String,
    commands: State<'_, VaultCommands<TauriDialog>>,
) -> Result<(), String> {
    commands.write_note(path, content).await
}

#[tauri::command]
pub async fn rename_note(
    source: String,
    destination: String,
    commands: State<'_, VaultCommands<TauriDialog>>,
) -> Result<(), String> {
    commands.rename_note(source, destination).await
}

#[tauri::command]
pub async fn trash_note(
    path: String,
    commands: State<'_, VaultCommands<TauriDialog>>,
) -> Result<(), String> {
    commands.trash_note(path).await
}

#[tauri::command]
pub async fn search_notes(
    query: String,
    commands: State<'_, VaultCommands<TauriDialog>>,
) -> Result<Vec<NoteSummary>, String> {
    commands.search_notes(query).await
}
