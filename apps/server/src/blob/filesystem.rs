use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use rand::{RngCore, rngs::OsRng};

use super::{BlobStore, BlobStoreError, CiphertextHash, StoredCiphertext};

const HASH_LENGTH: usize = 64;
const SHARD_LENGTH: usize = 2;

pub struct FilesystemBlobStore {
    root: PathBuf,
}

impl FilesystemBlobStore {
    pub fn open(root: impl AsRef<Path>) -> Result<Self, BlobStoreError> {
        fs::create_dir_all(root.as_ref())?;
        set_directory_permissions(root.as_ref())?;

        let metadata = fs::symlink_metadata(root.as_ref())?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(BlobStoreError::InvalidBlob);
        }

        Ok(Self {
            root: fs::canonicalize(root)?,
        })
    }

    fn path_for(&self, hash: &CiphertextHash) -> PathBuf {
        let hash = hash.as_hex();
        self.root.join(&hash[..SHARD_LENGTH]).join(hash)
    }

    fn existing_file_path(&self, hash: &CiphertextHash) -> Result<Option<PathBuf>, BlobStoreError> {
        let path = self.path_for(hash);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
                self.ensure_contained(&fs::canonicalize(&path)?)?;
                Ok(Some(path))
            }
            Ok(_) => Err(BlobStoreError::InvalidBlob),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn create_bucket(&self, hash: &CiphertextHash) -> Result<PathBuf, BlobStoreError> {
        let path = self.path_for(hash);
        let bucket = path.parent().ok_or(BlobStoreError::InvalidBlob)?;
        fs::create_dir_all(bucket)?;
        set_directory_permissions(bucket)?;

        let metadata = fs::symlink_metadata(bucket)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(BlobStoreError::InvalidBlob);
        }

        self.ensure_contained(&fs::canonicalize(bucket)?)?;
        Ok(path)
    }

    fn ensure_contained(&self, path: &Path) -> Result<(), BlobStoreError> {
        if path.starts_with(&self.root) {
            Ok(())
        } else {
            Err(BlobStoreError::InvalidBlob)
        }
    }

    fn write_atomically(
        &self,
        path: &Path,
        nonce: &[u8],
        ciphertext: &[u8],
    ) -> Result<(), BlobStoreError> {
        let parent = path.parent().ok_or(BlobStoreError::InvalidBlob)?;
        self.ensure_contained(&fs::canonicalize(parent)?)?;
        let contents = encode_blob(nonce, ciphertext)?;

        for _ in 0..16 {
            let temporary_path = parent.join(format!(".{}.tmp", random_suffix()));
            let mut file = match open_private_new_file(&temporary_path) {
                Ok(file) => file,
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.into()),
            };
            file.write_all(&contents)?;
            file.sync_all()?;
            drop(file);

            match fs::hard_link(&temporary_path, path) {
                Ok(()) => {
                    fs::remove_file(&temporary_path)?;
                    sync_directory(parent)?;
                    return Ok(());
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    let _ = fs::remove_file(&temporary_path);
                    return Ok(());
                }
                Err(error) => {
                    let _ = fs::remove_file(&temporary_path);
                    return Err(error.into());
                }
            }
        }

        Err(BlobStoreError::Io(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not allocate a temporary blob file",
        )))
    }
}

impl BlobStore for FilesystemBlobStore {
    fn put_ciphertext(
        &self,
        ciphertext: &[u8],
        nonce: &[u8],
        declared_hash: &CiphertextHash,
    ) -> Result<(), BlobStoreError> {
        if CiphertextHash::from_ciphertext(ciphertext) != *declared_hash {
            return Err(BlobStoreError::HashMismatch);
        }

        if self.existing_file_path(declared_hash)?.is_some() {
            return Ok(());
        }

        let path = self.create_bucket(declared_hash)?;
        if self.existing_file_path(declared_hash)?.is_none() {
            self.write_atomically(&path, nonce, ciphertext)?;
        }
        Ok(())
    }

    fn get_ciphertext(
        &self,
        hash: &CiphertextHash,
    ) -> Result<Option<StoredCiphertext>, BlobStoreError> {
        let Some(path) = self.existing_file_path(hash)? else {
            return Ok(None);
        };

        let mut contents = Vec::new();
        File::open(path)?.read_to_end(&mut contents)?;
        let (nonce, ciphertext) = decode_blob(&contents)?;
        if CiphertextHash::from_ciphertext(&ciphertext) != *hash {
            return Err(BlobStoreError::InvalidBlob);
        }
        Ok(Some(StoredCiphertext::new(ciphertext, nonce)))
    }

    fn exists(&self, hash: &CiphertextHash) -> Result<bool, BlobStoreError> {
        Ok(self.existing_file_path(hash)?.is_some())
    }

    fn delete_unreferenced(
        &self,
        referenced_hashes: &HashSet<CiphertextHash>,
    ) -> Result<usize, BlobStoreError> {
        let mut deleted = 0;
        for shard in fs::read_dir(&self.root)? {
            let shard = shard?;
            let shard_name = shard.file_name();
            let Some(shard_name) = shard_name.to_str() else {
                continue;
            };
            if !is_lower_hex(shard_name, SHARD_LENGTH) {
                continue;
            }

            let metadata = fs::symlink_metadata(shard.path())?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(BlobStoreError::InvalidBlob);
            }
            let shard_path = fs::canonicalize(shard.path())?;
            self.ensure_contained(&shard_path)?;

            for entry in fs::read_dir(shard_path)? {
                let entry = entry?;
                let name = entry.file_name();
                let Some(name) = name.to_str() else {
                    continue;
                };
                if !is_lower_hex(name, HASH_LENGTH) || !name.starts_with(shard_name) {
                    continue;
                }

                let path = entry.path();
                let metadata = fs::symlink_metadata(&path)?;
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(BlobStoreError::InvalidBlob);
                }
                self.ensure_contained(&fs::canonicalize(&path)?)?;
                let hash = CiphertextHash::from_hex(name)?;
                if !referenced_hashes.contains(&hash) {
                    fs::remove_file(path)?;
                    deleted += 1;
                }
            }
        }
        Ok(deleted)
    }
}

impl CiphertextHash {
    fn from_hex(value: &str) -> Result<Self, BlobStoreError> {
        if !is_lower_hex(value, HASH_LENGTH) {
            return Err(BlobStoreError::InvalidBlob);
        }
        let mut bytes = [0; 32];
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
                .map_err(|_| BlobStoreError::InvalidBlob)?;
        }
        Ok(Self(bytes))
    }
}

fn encode_blob(nonce: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, BlobStoreError> {
    let nonce_length = u32::try_from(nonce.len()).map_err(|_| BlobStoreError::InvalidBlob)?;
    let mut contents = Vec::with_capacity(4 + nonce.len() + ciphertext.len());
    contents.extend_from_slice(&nonce_length.to_be_bytes());
    contents.extend_from_slice(nonce);
    contents.extend_from_slice(ciphertext);
    Ok(contents)
}

fn decode_blob(contents: &[u8]) -> Result<(Vec<u8>, Vec<u8>), BlobStoreError> {
    let nonce_length = contents
        .get(..4)
        .ok_or(BlobStoreError::InvalidBlob)
        .and_then(|bytes| {
            usize::try_from(u32::from_be_bytes(
                bytes.try_into().map_err(|_| BlobStoreError::InvalidBlob)?,
            ))
            .map_err(|_| BlobStoreError::InvalidBlob)
        })?;
    let nonce_end = 4usize
        .checked_add(nonce_length)
        .ok_or(BlobStoreError::InvalidBlob)?;
    let nonce = contents
        .get(4..nonce_end)
        .ok_or(BlobStoreError::InvalidBlob)?
        .to_vec();
    let ciphertext = contents
        .get(nonce_end..)
        .ok_or(BlobStoreError::InvalidBlob)?
        .to_vec();
    Ok((nonce, ciphertext))
}

fn is_lower_hex(value: &str, expected_length: usize) -> bool {
    value.len() == expected_length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn random_suffix() -> String {
    let mut bytes = [0; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn open_private_new_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    set_file_mode(&mut options);
    options.open(path)
}

fn set_directory_permissions(path: &Path) -> io::Result<()> {
    let _ = path;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn set_file_mode(options: &mut OpenOptions) {
    let _ = options;
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
}

fn sync_directory(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()?;
    }
    Ok(())
}
