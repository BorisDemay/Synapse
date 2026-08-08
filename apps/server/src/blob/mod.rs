mod filesystem;

use std::{collections::HashSet, fmt};

use sha2::{Digest, Sha256};

pub use filesystem::FilesystemBlobStore;

#[derive(Clone, Eq, PartialEq, Hash)]
pub struct CiphertextHash([u8; 32]);

impl CiphertextHash {
    pub fn from_ciphertext(ciphertext: &[u8]) -> Self {
        Self(Sha256::digest(ciphertext).into())
    }

    pub(crate) fn as_hex(&self) -> String {
        self.0.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    pub(crate) fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Debug for CiphertextHash {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("CiphertextHash")
            .field(&self.as_hex())
            .finish()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoredCiphertext {
    ciphertext: Vec<u8>,
    nonce: Vec<u8>,
}

impl StoredCiphertext {
    pub(crate) fn new(ciphertext: Vec<u8>, nonce: Vec<u8>) -> Self {
        Self { ciphertext, nonce }
    }

    pub fn ciphertext(&self) -> &[u8] {
        &self.ciphertext
    }

    pub fn nonce(&self) -> &[u8] {
        &self.nonce
    }
}

#[derive(Debug)]
pub enum BlobStoreError {
    HashMismatch,
    InvalidBlob,
    Io(std::io::Error),
}

impl fmt::Display for BlobStoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HashMismatch => formatter.write_str("ciphertext hash does not match ciphertext"),
            Self::InvalidBlob => formatter.write_str("blob storage entry is invalid"),
            Self::Io(_) => formatter.write_str("blob storage operation failed"),
        }
    }
}

impl std::error::Error for BlobStoreError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::HashMismatch | Self::InvalidBlob => None,
        }
    }
}

impl From<std::io::Error> for BlobStoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

pub trait BlobStore: Send + Sync {
    fn put_ciphertext(
        &self,
        ciphertext: &[u8],
        nonce: &[u8],
        declared_hash: &CiphertextHash,
    ) -> Result<(), BlobStoreError>;

    fn get_ciphertext(
        &self,
        hash: &CiphertextHash,
    ) -> Result<Option<StoredCiphertext>, BlobStoreError>;

    fn exists(&self, hash: &CiphertextHash) -> Result<bool, BlobStoreError>;

    fn delete_unreferenced(
        &self,
        referenced_hashes: &HashSet<CiphertextHash>,
    ) -> Result<usize, BlobStoreError>;
}
