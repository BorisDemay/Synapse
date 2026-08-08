use std::fmt;

use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::blob::{BlobStore, CiphertextHash};

pub const MAX_CIPHERTEXT_BYTES: usize = 1_048_576;
const NONCE_BYTES: usize = 24;
const MIN_CIPHERTEXT_BYTES: usize = 16;
const PROTOCOL_VERSION: u8 = 1;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PushOperation {
    protocol_version: u8,
    pub operation_id: String,
    pub vault_id: String,
    pub note_id: String,
    pub base_revision: u64,
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    aad_version: u8,
    pub ciphertext_hash: String,
}

impl PushOperation {
    pub fn validate(&self, route_vault_id: Uuid) -> Result<(Uuid, Uuid), ApplyError> {
        if self.protocol_version != PROTOCOL_VERSION
            || self.aad_version != PROTOCOL_VERSION
            || self.ciphertext.len() < MIN_CIPHERTEXT_BYTES
            || self.ciphertext.len() > MAX_CIPHERTEXT_BYTES
            || self.nonce.len() != NONCE_BYTES
        {
            return Err(ApplyError::Invalid);
        }
        let operation_id = canonical_uuid_v7(&self.operation_id).ok_or(ApplyError::Invalid)?;
        let vault_id = canonical_uuid(&self.vault_id).ok_or(ApplyError::Invalid)?;
        let note_id = canonical_uuid(&self.note_id).ok_or(ApplyError::Invalid)?;
        if vault_id != route_vault_id || note_id.is_nil() || operation_id.is_nil() {
            return Err(ApplyError::Invalid);
        }
        let hash = CiphertextHash::from_ciphertext(&self.ciphertext);
        if hash.as_hex() != self.ciphertext_hash {
            return Err(ApplyError::Invalid);
        }
        Ok((operation_id, vault_id))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PushAck {
    pub operation_id: Uuid,
    pub revision: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ApplyError {
    Conflict,
    Database,
    Invalid,
    NotFound,
    Storage,
}

impl fmt::Display for ApplyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Conflict => "operation conflicts with the current revision",
            Self::Database => "sync database operation failed",
            Self::Invalid => "encrypted push operation is invalid",
            Self::NotFound => "vault is not available",
            Self::Storage => "ciphertext storage operation failed",
        })
    }
}

impl std::error::Error for ApplyError {}

pub async fn apply(
    pool: &PgPool,
    blob_store: &dyn BlobStore,
    user_id: Uuid,
    route_vault_id: Uuid,
    operation: PushOperation,
) -> Result<PushAck, ApplyError> {
    let (operation_id, vault_id) = operation.validate(route_vault_id)?;
    let ciphertext_hash = CiphertextHash::from_ciphertext(&operation.ciphertext);
    let mut transaction = pool.begin().await.map_err(|_| ApplyError::Database)?;

    let current_revision = sqlx::query_scalar::<_, i64>(
        "SELECT current_revision FROM vaults \
         WHERE id = $1::uuid AND owner_user_id = $2::uuid FOR UPDATE",
    )
    .bind(vault_id.to_string())
    .bind(user_id.to_string())
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|_| ApplyError::Database)?
    .ok_or(ApplyError::NotFound)?;

    let existing = sqlx::query_as::<_, (String, Option<i64>)>(
        "SELECT vault_id::text, applied_revision FROM operations WHERE id = $1::uuid",
    )
    .bind(operation_id.to_string())
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|_| ApplyError::Database)?;
    if let Some((existing_vault_id, Some(revision))) = existing {
        if existing_vault_id == vault_id.to_string() {
            transaction
                .commit()
                .await
                .map_err(|_| ApplyError::Database)?;
            return Ok(PushAck {
                operation_id,
                revision,
            });
        }
        return Err(ApplyError::NotFound);
    }
    if existing.is_some() {
        return Err(ApplyError::Database);
    }

    if operation.base_revision
        != u64::try_from(current_revision).map_err(|_| ApplyError::Database)?
    {
        return Err(ApplyError::Conflict);
    }
    let next_revision = current_revision
        .checked_add(1)
        .ok_or(ApplyError::Database)?;

    // PostgreSQL cannot atomically commit a filesystem write. The blob is made
    // durable before its SQL reference; a failed SQL transaction leaves at most
    // an unreachable content-addressed blob, which reconciliation may remove.
    blob_store
        .put_ciphertext(&operation.ciphertext, &operation.nonce, &ciphertext_hash)
        .map_err(|_| ApplyError::Storage)?;

    sqlx::query(
        "INSERT INTO blobs (ciphertext_hash, byte_length) VALUES ($1, $2) \
         ON CONFLICT (ciphertext_hash) DO NOTHING",
    )
    .bind(ciphertext_hash.as_bytes().as_slice())
    .bind(i64::try_from(operation.ciphertext.len()).map_err(|_| ApplyError::Invalid)?)
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApplyError::Database)?;
    sqlx::query(
        "INSERT INTO revisions (vault_id, revision, operation_id, ciphertext_hash) \
         VALUES ($1::uuid, $2, $3::uuid, $4)",
    )
    .bind(vault_id.to_string())
    .bind(next_revision)
    .bind(operation_id.to_string())
    .bind(ciphertext_hash.as_bytes().as_slice())
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApplyError::Database)?;
    sqlx::query(
        "INSERT INTO operations \
         (id, vault_id, base_revision, applied_revision, note_id, ciphertext, nonce, ciphertext_hash) \
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7, $8)",
    )
    .bind(operation_id.to_string())
    .bind(vault_id.to_string())
    .bind(i64::try_from(operation.base_revision).map_err(|_| ApplyError::Invalid)?)
    .bind(next_revision)
    .bind(operation.note_id)
    .bind(operation.ciphertext)
    .bind(operation.nonce)
    .bind(ciphertext_hash.as_bytes().as_slice())
    .execute(&mut *transaction)
    .await
    .map_err(|_| ApplyError::Database)?;
    sqlx::query("UPDATE vaults SET current_revision = $1 WHERE id = $2::uuid")
        .bind(next_revision)
        .bind(vault_id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApplyError::Database)?;
    transaction
        .commit()
        .await
        .map_err(|_| ApplyError::Database)?;

    Ok(PushAck {
        operation_id,
        revision: next_revision,
    })
}

fn canonical_uuid(value: &str) -> Option<Uuid> {
    let id = Uuid::parse_str(value).ok()?;
    (id.to_string() == value).then_some(id)
}

fn canonical_uuid_v7(value: &str) -> Option<Uuid> {
    let id = canonical_uuid(value)?;
    (id.get_version() == Some(uuid::Version::SortRand)).then_some(id)
}
