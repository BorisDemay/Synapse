use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use synapse_core::{ContentHash, VaultAssetPath, VaultError, VaultId, VaultPath, VaultService};

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

#[derive(Default, Deserialize, Serialize)]
struct Manifest {
    owner: String,
    hashes: BTreeMap<String, Vec<String>>,
}

pub struct LocalFolderMirror {
    root: PathBuf,
    vault: VaultService,
    written: BTreeSet<String>,
    hashes: BTreeMap<String, Vec<String>>,
    owner: String,
}

impl LocalFolderMirror {
    pub async fn open(root: impl AsRef<Path>) -> Result<Self, String> {
        Self::open_for_vault(root, "test-profile").await
    }

    pub async fn open_for_vault(root: impl AsRef<Path>, owner: &str) -> Result<Self, String> {
        let root = root.as_ref();
        ensure_root_directory(root).await?;
        let vault = VaultService::open(root)
            .await
            .map_err(|_| "local folder is unavailable")?;
        let root = tokio::fs::canonicalize(root)
            .await
            .map_err(|_| "local folder is unavailable")?;
        let manifest = VaultAssetPath::parse("attachments/.synapse-mirror.json").unwrap();
        let manifest: Manifest = match vault.read_attachment(&manifest).await {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "invalid mirror manifest")?,
            Err(VaultError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                Manifest {
                    owner: owner.to_owned(),
                    ..Manifest::default()
                }
            }
            Err(_) => return Err("local folder is unavailable".into()),
        };
        if manifest.owner != owner {
            return Err("local folder belongs to another vault".into());
        }
        let hashes = manifest.hashes;
        for (path, hash) in &hashes {
            if (VaultPath::parse(path).is_err() && VaultAssetPath::parse(path).is_err())
                || hash.is_empty()
                || hash
                    .iter()
                    .any(|value| ContentHash::from_hex(value).is_none())
            {
                return Err("invalid mirror manifest".into());
            }
        }
        Ok(Self {
            written: hashes.keys().cloned().collect(),
            hashes,
            owner: owner.to_owned(),
            root,
            vault,
        })
    }

    pub async fn claim_selection(&self) -> Result<(), String> {
        let manifest = self.root.join("attachments/.synapse-mirror.json");
        if !tokio::fs::try_exists(&manifest)
            .await
            .map_err(|_| "local folder is unavailable")?
        {
            let mut entries = tokio::fs::read_dir(&self.root)
                .await
                .map_err(|_| "local folder is unavailable")?;
            if entries
                .next_entry()
                .await
                .map_err(|_| "local folder is unavailable")?
                .is_some()
            {
                return Err("choose an empty folder or import its files explicitly".into());
            }
        }
        self.persist_manifest().await
    }

    pub fn set_written(&mut self, written: BTreeSet<String>) {
        self.written.extend(written);
    }

    pub fn written(&self) -> BTreeSet<String> {
        self.written.clone()
    }

    pub fn root(&self) -> PathBuf {
        self.root.clone()
    }

    pub async fn apply(&mut self, entries: &[FolderEntry]) -> Result<(), String> {
        for entry in entries {
            if self.prepare(entry).await? {
                self.upsert(entry).await?;
                self.persist_manifest().await?;
            }
        }
        self.persist_manifest().await
    }

    pub async fn replace_snapshot(&mut self, entries: &[FolderEntry]) -> Result<(), String> {
        let mut normalized = BTreeSet::new();
        for entry in entries {
            if !normalized.insert(entry.relative_path().to_lowercase()) {
                return Err("duplicate or case-colliding vault paths".into());
            }
        }
        let mut keep = BTreeSet::new();
        for entry in entries {
            if self.prepare(entry).await? {
                self.upsert(entry).await?;
                self.persist_manifest().await?;
            }
            keep.insert(entry.relative_path().to_owned());
        }
        let stale: Vec<String> = self.written.difference(&keep).cloned().collect();
        for path in stale {
            self.delete(&path).await?;
            self.written.remove(&path);
            self.hashes.remove(&path);
        }
        self.written = keep;
        self.persist_manifest().await
    }

    async fn upsert(&mut self, entry: &FolderEntry) -> Result<(), String> {
        if entry.relative_path() == "attachments/.synapse-mirror.json" {
            return Err("reserved vault path".into());
        }
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
                        self.verify_owned(path, existing.as_bytes())?;
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
                self.hashes.insert(
                    path.clone(),
                    vec![ContentHash::from_bytes(markdown.as_bytes()).to_string()],
                );
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
                        self.verify_owned(path, &existing)?;
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
                self.hashes.insert(
                    path.clone(),
                    vec![ContentHash::from_bytes(bytes).to_string()],
                );
                self.written.insert(parsed.as_str().to_owned());
            }
        }
        Ok(())
    }

    async fn prepare(&mut self, entry: &FolderEntry) -> Result<bool, String> {
        let (path, bytes) = match entry {
            FolderEntry::Note { path, markdown } => {
                let parsed = VaultPath::parse(path).map_err(|_| "invalid vault path")?;
                match self.vault.read_note(&parsed).await {
                    Ok(old) => {
                        self.verify_owned(path, old.as_bytes())?;
                        if old.as_bytes() == markdown.as_bytes() {
                            return Ok(false);
                        }
                    }
                    Err(VaultError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(_) => return Err("local folder write failed".into()),
                }
                (path, markdown.as_bytes())
            }
            FolderEntry::Attachment { path, bytes } => {
                if path == "attachments/.synapse-mirror.json" {
                    return Err("reserved vault path".into());
                }
                let parsed = VaultAssetPath::parse(path).map_err(|_| "invalid vault path")?;
                match self.vault.read_attachment(&parsed).await {
                    Ok(old) => {
                        self.verify_owned(path, &old)?;
                        if old == *bytes {
                            return Ok(false);
                        }
                    }
                    Err(VaultError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(_) => return Err("local folder write failed".into()),
                }
                (path, bytes.as_slice())
            }
        };
        let next = ContentHash::from_bytes(bytes).to_string();
        let hashes = self.hashes.entry(path.clone()).or_default();
        if !hashes.contains(&next) {
            hashes.push(next);
        }
        self.persist_manifest().await?;
        Ok(true)
    }

    fn verify_owned(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        if !self
            .hashes
            .get(path)
            .is_some_and(|values| values.contains(&ContentHash::from_bytes(bytes).to_string()))
        {
            return Err("local folder contains unknown or externally modified files".into());
        }
        Ok(())
    }

    async fn persist_manifest(&self) -> Result<(), String> {
        let path = VaultAssetPath::parse("attachments/.synapse-mirror.json").unwrap();
        let bytes = serde_json::to_vec(&Manifest {
            owner: self.owner.clone(),
            hashes: self.hashes.clone(),
        })
        .map_err(|_| "local folder write failed")?;
        match self.vault.create_attachment(&path, &bytes).await {
            Ok(()) => Ok(()),
            Err(VaultError::AlreadyExists) => {
                let old = self
                    .vault
                    .read_attachment(&path)
                    .await
                    .map_err(|_| "local folder write failed")?;
                if old == bytes {
                    return Ok(());
                }
                self.vault
                    .replace_attachment_if_unchanged(&path, &ContentHash::from_bytes(&old), &bytes)
                    .await
                    .map_err(|_| "local folder write failed".into())
            }
            Err(_) => Err("local folder write failed".into()),
        }
    }

    async fn delete(&self, path: &str) -> Result<(), String> {
        if let Ok(note) = VaultPath::parse(path) {
            let bytes = match self.vault.read_note(&note).await {
                Ok(bytes) => bytes,
                Err(VaultError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(_) => return Err("local folder write failed".into()),
            };
            self.verify_owned(path, bytes.as_bytes())?;
            return self
                .vault
                .delete_note(&note)
                .await
                .map_err(|_| "local folder write failed".into());
        }
        if let Ok(attachment) = VaultAssetPath::parse(path) {
            let bytes = match self.vault.read_attachment(&attachment).await {
                Ok(bytes) => bytes,
                Err(VaultError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(_) => return Err("local folder write failed".into()),
            };
            self.verify_owned(path, &bytes)?;
            return self
                .vault
                .delete_attachment(&attachment)
                .await
                .map_err(|_| "local folder write failed".into());
        }
        Err("invalid vault path".into())
    }
}

async fn ensure_root_directory(root: &Path) -> Result<(), String> {
    let mut directory = PathBuf::new();

    for component in root.components() {
        match component {
            Component::CurDir => continue,
            Component::ParentDir => return Err("local folder is unavailable".into()),
            _ => directory.push(component.as_os_str()),
        }

        match tokio::fs::symlink_metadata(&directory).await {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err("local folder is unavailable".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                tokio::fs::create_dir(&directory)
                    .await
                    .map_err(|_| "local folder is unavailable")?;
            }
            Err(_) => return Err("local folder is unavailable".into()),
        }
    }

    Ok(())
}

pub fn default_folder_path(documents_or_data: &Path, vault_id: &str) -> Result<PathBuf, String> {
    VaultId::parse(vault_id).map_err(|_| "invalid vault path")?;
    Ok(documents_or_data.join("Synapse").join(vault_id))
}
