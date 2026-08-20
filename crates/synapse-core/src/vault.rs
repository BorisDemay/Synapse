use std::error::Error;
use std::fmt;
use std::path::{Path, PathBuf};

use crate::{ContentHash, VaultAssetPath, VaultPath, fs};

const MAX_NOTE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Clone)]
pub struct VaultService {
    root: PathBuf,
}

#[derive(Debug)]
pub enum VaultError {
    AlreadyExists,
    ContentChanged,
    Io(std::io::Error),
    InvalidRoot,
    NoteTooLarge,
    NotAFile,
    PathEscapesVault,
}

impl fmt::Display for VaultError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyExists => formatter.write_str("vault path already exists"),
            Self::ContentChanged => formatter.write_str("vault note changed on disk"),
            Self::Io(error) => error.fmt(formatter),
            Self::InvalidRoot => formatter.write_str("vault root must be an existing directory"),
            Self::NoteTooLarge => formatter.write_str("vault note exceeds the maximum size"),
            Self::NotAFile => formatter.write_str("vault path is not a file"),
            Self::PathEscapesVault => formatter.write_str("vault path escapes the vault root"),
        }
    }
}

impl Error for VaultError {}

pub type VaultResult<T> = Result<T, VaultError>;

impl VaultService {
    pub async fn open(root: impl AsRef<Path>) -> VaultResult<Self> {
        let root = tokio::fs::canonicalize(root)
            .await
            .map_err(VaultError::Io)?;
        if !tokio::fs::metadata(&root)
            .await
            .map_err(VaultError::Io)?
            .is_dir()
        {
            return Err(VaultError::InvalidRoot);
        }

        Ok(Self { root })
    }

    pub async fn create_note(&self, path: &VaultPath, content: &str) -> VaultResult<()> {
        if content.len() > MAX_NOTE_BYTES {
            return Err(VaultError::NoteTooLarge);
        }
        fs::write_atomically(&self.root, path.as_str(), content).await
    }

    pub async fn read_note(&self, path: &VaultPath) -> VaultResult<String> {
        fs::read_note(&self.root, path.as_str()).await
    }

    pub async fn replace_note_if_unchanged(
        &self,
        path: &VaultPath,
        expected_hash: &ContentHash,
        content: &str,
    ) -> VaultResult<()> {
        if content.len() > MAX_NOTE_BYTES {
            return Err(VaultError::NoteTooLarge);
        }
        fs::replace_if_unchanged(&self.root, path.as_str(), expected_hash, content).await
    }

    pub async fn rename_note(
        &self,
        source: &VaultPath,
        destination: &VaultPath,
    ) -> VaultResult<()> {
        fs::rename_note(&self.root, source.as_str(), destination.as_str()).await
    }

    pub async fn delete_note(&self, path: &VaultPath) -> VaultResult<()> {
        fs::move_to_trash(&self.root, path.as_str()).await
    }

    pub async fn create_attachment(
        &self,
        path: &VaultAssetPath,
        content: &[u8],
    ) -> VaultResult<()> {
        if content.len() > MAX_NOTE_BYTES {
            return Err(VaultError::NoteTooLarge);
        }
        fs::write_bytes_atomically(&self.root, path.as_str(), content).await
    }

    pub async fn read_attachment(&self, path: &VaultAssetPath) -> VaultResult<Vec<u8>> {
        fs::read_bytes(&self.root, path.as_str()).await
    }

    pub async fn replace_attachment_if_unchanged(
        &self,
        path: &VaultAssetPath,
        expected_hash: &ContentHash,
        content: &[u8],
    ) -> VaultResult<()> {
        if content.len() > MAX_NOTE_BYTES {
            return Err(VaultError::NoteTooLarge);
        }
        fs::replace_bytes_if_unchanged(&self.root, path.as_str(), expected_hash, content).await
    }

    pub async fn rename_attachment(
        &self,
        source: &VaultAssetPath,
        destination: &VaultAssetPath,
    ) -> VaultResult<()> {
        fs::rename_note(&self.root, source.as_str(), destination.as_str()).await
    }

    pub async fn delete_attachment(&self, path: &VaultAssetPath) -> VaultResult<()> {
        fs::move_to_trash(&self.root, path.as_str()).await
    }
}
