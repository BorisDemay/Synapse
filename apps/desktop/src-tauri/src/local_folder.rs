use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use synapse_core::{
    ContentHash, VaultAssetPath, VaultError, VaultId, VaultPath, VaultService,
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FolderEntry {
    Note { path: String, markdown: String },
    Attachment { path: String, bytes: Vec<u8> },
}

impl FolderEntry {
    fn relative_path(&self) -> &str {
        match self {
            Self::Note { path, .. } | Self::Attachment { path, .. } => path,
        }
    }
}

pub struct LocalFolderMirror {
    root: PathBuf,
    vault: VaultService,
    written: BTreeSet<String>,
}

impl LocalFolderMirror {
    pub async fn open(root: impl AsRef<Path>) -> Result<Self, String> {
        let root = root.as_ref();
        tokio::fs::create_dir_all(root)
            .await
            .map_err(|_| "local folder is unavailable")?;
        let vault = VaultService::open(root)
            .await
            .map_err(|_| "local folder is unavailable")?;
        let root = tokio::fs::canonicalize(root)
            .await
            .map_err(|_| "local folder is unavailable")?;
        Ok(Self {
            root,
            vault,
            written: BTreeSet::new(),
        })
    }

    pub fn set_written(&mut self, written: BTreeSet<String>) {
        self.written = written;
    }

    pub fn written(&self) -> BTreeSet<String> {
        self.written.clone()
    }

    pub fn root(&self) -> PathBuf {
        self.root.clone()
    }

    pub async fn apply(&mut self, entries: &[FolderEntry]) -> Result<(), String> {
        for entry in entries {
            self.upsert(entry).await?;
        }
        Ok(())
    }

    pub async fn replace_snapshot(&mut self, entries: &[FolderEntry]) -> Result<(), String> {
        let mut keep = BTreeSet::new();
        for entry in entries {
            self.upsert(entry).await?;
            keep.insert(entry.relative_path().to_owned());
        }
        let stale: Vec<String> = self.written.difference(&keep).cloned().collect();
        for path in stale {
            self.delete(&path).await?;
            self.written.remove(&path);
        }
        self.written = keep;
        Ok(())
    }

    async fn upsert(&mut self, entry: &FolderEntry) -> Result<(), String> {
        match entry {
            FolderEntry::Note { path, markdown } => {
                let parsed = VaultPath::parse(path).map_err(|_| "invalid vault path")?;
                match self.vault.create_note(&parsed, markdown).await {
                    Ok(()) => {}
                    Err(VaultError::AlreadyExists) => {
                        let existing = self
                            .vault
                            .read_note(&parsed)
                            .await
                            .map_err(|_| "local folder write failed")?;
                        self.vault
                            .replace_note_if_unchanged(
                                &parsed,
                                &ContentHash::from_bytes(existing.as_bytes()),
                                markdown,
                            )
                            .await
                            .map_err(|_| "local folder write failed")?;
                    }
                    Err(_) => return Err("local folder write failed".into()),
                }
                self.written.insert(parsed.as_str().to_owned());
            }
            FolderEntry::Attachment { path, bytes } => {
                let parsed = VaultAssetPath::parse(path).map_err(|_| "invalid vault path")?;
                match self.vault.create_attachment(&parsed, bytes).await {
                    Ok(()) => {}
                    Err(VaultError::AlreadyExists) => {
                        let existing = self
                            .vault
                            .read_attachment(&parsed)
                            .await
                            .map_err(|_| "local folder write failed")?;
                        self.vault
                            .replace_attachment_if_unchanged(
                                &parsed,
                                &ContentHash::from_bytes(&existing),
                                bytes,
                            )
                            .await
                            .map_err(|_| "local folder write failed")?;
                    }
                    Err(_) => return Err("local folder write failed".into()),
                }
                self.written.insert(parsed.as_str().to_owned());
            }
        }
        Ok(())
    }

    async fn delete(&self, path: &str) -> Result<(), String> {
        if let Ok(note) = VaultPath::parse(path) {
            let _ = self.vault.delete_note(&note).await;
            return Ok(());
        }
        if let Ok(attachment) = VaultAssetPath::parse(path) {
            let _ = self.vault.delete_attachment(&attachment).await;
            return Ok(());
        }
        Err("invalid vault path".into())
    }
}

pub fn default_folder_path(documents_or_data: &Path, vault_id: &str) -> Result<PathBuf, String> {
    VaultId::parse(vault_id).map_err(|_| "invalid vault path")?;
    Ok(documents_or_data.join("Synapse").join(vault_id))
}
