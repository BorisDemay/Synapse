#![forbid(unsafe_code)]

mod reconcile;

use std::error::Error;
use std::fmt;

use synapse_core::{
    ContentHash, NoteId, OperationId, Revision, VaultId, VaultPath, VaultService, parse_note,
};
use synapse_crypto::{Aad, CryptoError, VaultCipher};
use synapse_local_store::{IndexedNote, LocalStore, PendingOperation, StoreError};
use synapse_protocol::v1::{EncryptedPushOperation, PROTOCOL_VERSION};

/// A user mutation with an operation identity allocated before filesystem work.
/// Reusing this value makes reconciliation and later server delivery idempotent.
#[derive(Clone)]
pub struct VaultMutation {
    operation_id: OperationId,
    note_id: NoteId,
    path: VaultPath,
    markdown: String,
    revision: Revision,
    base_revision: Revision,
    updated_at: i64,
}

impl VaultMutation {
    pub fn new(
        note_id: NoteId,
        path: VaultPath,
        markdown: impl Into<String>,
        revision: Revision,
        base_revision: Revision,
        updated_at: i64,
    ) -> Self {
        Self {
            operation_id: OperationId::new(),
            note_id,
            path,
            markdown: markdown.into(),
            revision,
            base_revision,
            updated_at,
        }
    }

    pub fn operation_id(&self) -> &OperationId {
        &self.operation_id
    }

    pub fn path(&self) -> &VaultPath {
        &self.path
    }
}

pub struct VaultOrchestrator {
    vault: VaultService,
    store: LocalStore,
    vault_id: VaultId,
    cipher: VaultCipher,
}

impl VaultOrchestrator {
    pub fn new(
        vault: VaultService,
        store: LocalStore,
        vault_id: VaultId,
        cipher: VaultCipher,
    ) -> Self {
        Self {
            vault,
            store,
            vault_id,
            cipher,
        }
    }

    pub fn store(&self) -> &LocalStore {
        &self.store
    }

    /// Writes the canonical file first, then persists its local index and
    /// already-encrypted sync operation in one SQLite transaction.
    pub async fn mutate(&mut self, mutation: &VaultMutation) -> VaultOrchestratorResult<()> {
        self.vault
            .create_note(&mutation.path, &mutation.markdown)
            .await
            .map_err(|_| VaultOrchestratorError::Filesystem)?;
        self.persist_existing_file(mutation).await
    }

    async fn persist_existing_file(
        &mut self,
        mutation: &VaultMutation,
    ) -> VaultOrchestratorResult<()> {
        let markdown = self
            .vault
            .read_note(&mutation.path)
            .await
            .map_err(|_| VaultOrchestratorError::Filesystem)?;
        let parsed = parse_note(&markdown).map_err(|_| VaultOrchestratorError::InvalidMarkdown)?;
        let note = IndexedNote {
            note_id: mutation.note_id.clone(),
            path: mutation.path.clone(),
            content_hash: ContentHash::from_bytes(markdown.as_bytes()),
            content: markdown,
            revision: mutation.revision,
            updated_at: mutation.updated_at,
        };
        let links = parsed
            .wikilinks
            .into_iter()
            .map(|link| link.target)
            .collect::<Vec<_>>();
        let aad = Aad::new(
            self.vault_id.clone(),
            mutation.note_id.clone(),
            mutation.revision,
        );
        let encrypted = self.cipher.encrypt(&aad, note.content.as_bytes())?;
        let (nonce, ciphertext) = encrypted.into_transport_parts();
        let payload = serde_json::to_vec(&EncryptedPushOperation {
            protocol_version: PROTOCOL_VERSION,
            operation_id: mutation.operation_id.to_string(),
            vault_id: self.vault_id.to_string(),
            note_id: mutation.note_id.to_string(),
            base_revision: mutation.base_revision.get(),
            ciphertext_hash: ContentHash::from_bytes(&ciphertext).to_string(),
            ciphertext,
            nonce: nonce.to_vec(),
            aad_version: PROTOCOL_VERSION,
            encrypted_vault_key_envelope: None,
        })
        .map_err(|_| VaultOrchestratorError::Serialization)?;
        let operation = PendingOperation {
            operation_id: mutation.operation_id.clone(),
            note_id: mutation.note_id.clone(),
            base_revision: mutation.base_revision,
            payload,
            created_at: mutation.updated_at,
        };

        self.store
            .persist_note_and_operation(&note, &links, &operation)?;

        Ok(())
    }
}

#[derive(Debug)]
pub enum VaultOrchestratorError {
    Crypto(CryptoError),
    Filesystem,
    InvalidMarkdown,
    Serialization,
    Store(StoreError),
}

impl fmt::Display for VaultOrchestratorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Crypto(error) => error.fmt(formatter),
            Self::Filesystem => formatter.write_str("local vault filesystem operation failed"),
            Self::InvalidMarkdown => formatter.write_str("local vault note could not be parsed"),
            Self::Serialization => formatter.write_str("encrypted operation serialization failed"),
            Self::Store(error) => error.fmt(formatter),
        }
    }
}

impl Error for VaultOrchestratorError {}

impl From<CryptoError> for VaultOrchestratorError {
    fn from(error: CryptoError) -> Self {
        Self::Crypto(error)
    }
}

impl From<StoreError> for VaultOrchestratorError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

pub type VaultOrchestratorResult<T> = Result<T, VaultOrchestratorError>;
