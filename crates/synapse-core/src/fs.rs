use std::path::{Path, PathBuf};

use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::{
    ContentHash,
    vault::{VaultError, VaultResult},
};

pub(super) async fn write_atomically(
    root: &Path,
    relative_path: &str,
    content: &str,
) -> VaultResult<()> {
    let destination = prepare_destination(root, relative_path).await?;
    match tokio::fs::symlink_metadata(&destination).await {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(VaultError::PathEscapesVault);
        }
        Ok(_) => return Err(VaultError::AlreadyExists),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(VaultError::Io(error)),
    }

    let temporary = write_temporary(&destination, content.as_bytes()).await?;
    match tokio::fs::hard_link(&temporary, &destination).await {
        Ok(()) => tokio::fs::remove_file(temporary)
            .await
            .map_err(VaultError::Io),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let _ = tokio::fs::remove_file(temporary).await;
            Err(VaultError::AlreadyExists)
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(temporary).await;
            Err(VaultError::Io(error))
        }
    }
}

pub(super) async fn replace_if_unchanged(
    root: &Path,
    relative_path: &str,
    expected_hash: &ContentHash,
    content: &str,
) -> VaultResult<()> {
    let destination = resolve_existing_file(root, relative_path).await?;
    let existing = tokio::fs::read(&destination)
        .await
        .map_err(VaultError::Io)?;
    if ContentHash::from_bytes(&existing) != *expected_hash {
        return Err(VaultError::ContentChanged);
    }

    let temporary = write_temporary(&destination, content.as_bytes()).await?;
    tokio::fs::rename(temporary, destination)
        .await
        .map_err(VaultError::Io)
}

pub(super) async fn write_bytes_atomically(
    root: &Path,
    relative_path: &str,
    content: &[u8],
) -> VaultResult<()> {
    let destination = prepare_destination(root, relative_path).await?;
    match tokio::fs::symlink_metadata(&destination).await {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(VaultError::PathEscapesVault);
        }
        Ok(_) => return Err(VaultError::AlreadyExists),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(VaultError::Io(error)),
    }

    let temporary = write_temporary(&destination, content).await?;
    match tokio::fs::hard_link(&temporary, &destination).await {
        Ok(()) => tokio::fs::remove_file(temporary)
            .await
            .map_err(VaultError::Io),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let _ = tokio::fs::remove_file(temporary).await;
            Err(VaultError::AlreadyExists)
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(temporary).await;
            Err(VaultError::Io(error))
        }
    }
}

pub(super) async fn replace_bytes_if_unchanged(
    root: &Path,
    relative_path: &str,
    expected_hash: &ContentHash,
    content: &[u8],
) -> VaultResult<()> {
    let destination = resolve_existing_file(root, relative_path).await?;
    let existing = tokio::fs::read(&destination)
        .await
        .map_err(VaultError::Io)?;
    if ContentHash::from_bytes(&existing) != *expected_hash {
        return Err(VaultError::ContentChanged);
    }

    let temporary = write_temporary(&destination, content).await?;
    tokio::fs::rename(temporary, destination)
        .await
        .map_err(VaultError::Io)
}

pub(super) async fn read_bytes(root: &Path, relative_path: &str) -> VaultResult<Vec<u8>> {
    let path = resolve_existing_file(root, relative_path).await?;
    tokio::fs::read(path).await.map_err(VaultError::Io)
}

pub(super) async fn read_note(root: &Path, relative_path: &str) -> VaultResult<String> {
    let path = resolve_existing_file(root, relative_path).await?;
    tokio::fs::read_to_string(path)
        .await
        .map_err(VaultError::Io)
}

pub(super) async fn rename_note(
    root: &Path,
    source_path: &str,
    destination_path: &str,
) -> VaultResult<()> {
    let source = resolve_existing_file(root, source_path).await?;
    let destination = prepare_destination(root, destination_path).await?;
    move_existing_file(source, destination).await
}

pub(super) async fn move_to_trash(root: &Path, relative_path: &str) -> VaultResult<()> {
    let source = resolve_existing_file(root, relative_path).await?;
    let destination = prepare_destination(root, &format!(".synapse-trash/{relative_path}")).await?;
    move_existing_file(source, destination).await
}

async fn move_existing_file(source: PathBuf, destination: PathBuf) -> VaultResult<()> {
    match tokio::fs::hard_link(&source, &destination).await {
        Ok(()) => tokio::fs::remove_file(source).await.map_err(VaultError::Io),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(VaultError::AlreadyExists)
        }
        Err(error) => Err(VaultError::Io(error)),
    }
}

async fn resolve_existing_file(root: &Path, relative_path: &str) -> VaultResult<PathBuf> {
    let mut path = root.to_path_buf();
    let mut components = relative_path.split('/').peekable();

    while let Some(component) = components.next() {
        path.push(component);
        let metadata = tokio::fs::symlink_metadata(&path)
            .await
            .map_err(VaultError::Io)?;
        if metadata.file_type().is_symlink() {
            return Err(VaultError::PathEscapesVault);
        }
        if components.peek().is_some() {
            if !metadata.is_dir() {
                return Err(VaultError::PathEscapesVault);
            }
        } else if !metadata.is_file() {
            return Err(VaultError::NotAFile);
        }
    }

    Ok(path)
}

async fn prepare_destination(root: &Path, relative_path: &str) -> VaultResult<PathBuf> {
    let mut directory = root.to_path_buf();
    let mut components = relative_path.split('/').peekable();

    while let Some(component) = components.next() {
        if components.peek().is_none() {
            return Ok(directory.join(component));
        }

        directory.push(component);
        match tokio::fs::symlink_metadata(&directory).await {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(VaultError::PathEscapesVault);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                tokio::fs::create_dir(&directory)
                    .await
                    .map_err(VaultError::Io)?;
            }
            Err(error) => return Err(VaultError::Io(error)),
        }

        let canonical = tokio::fs::canonicalize(&directory)
            .await
            .map_err(VaultError::Io)?;
        if !canonical.starts_with(root) {
            return Err(VaultError::PathEscapesVault);
        }
        directory = canonical;
    }

    Err(VaultError::PathEscapesVault)
}

fn temporary_path(destination: &Path) -> PathBuf {
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("note.md");
    destination.with_file_name(format!(".{file_name}.{}.synapse-tmp", Uuid::now_v7()))
}

async fn write_temporary(destination: &Path, content: &[u8]) -> VaultResult<PathBuf> {
    let temporary = temporary_path(destination);
    let mut file = tokio::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .await
        .map_err(VaultError::Io)?;
    file.write_all(content).await.map_err(VaultError::Io)?;
    file.sync_all().await.map_err(VaultError::Io)?;
    Ok(temporary)
}
