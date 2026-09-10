use std::fmt;

use serde::Deserialize;
use sqlx::PgPool;
use synapse_protocol::v1::Conflict;
use uuid::Uuid;

use crate::blob::{BlobStore, CiphertextHash};

pub const MAX_CIPHERTEXT_BYTES: usize = 10 * 1024 * 1024 + 256;
pub const ACCOUNT_STORAGE_QUOTA_BYTES: i64 = 1024 * 1024 * 1024;
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
    pub new_revision: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ApplyError {
    Conflict(Box<Conflict>),
    RevisionMismatch,
    Database,
    Invalid,
    NotFound,
    QuotaExceeded,
    Storage,
}

impl fmt::Display for ApplyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Conflict(_) => "operation conflicts with the current revision",
            Self::RevisionMismatch => "operation conflicts with the current revision",
            Self::Database => "sync database operation failed",
            Self::Invalid => "encrypted push operation is invalid",
            Self::NotFound => "vault is not available",
            Self::QuotaExceeded => "account storage quota exceeded",
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

    let existing =
        sqlx::query_as::<_, (String, Option<i64>, String, i64, Vec<u8>, Vec<u8>, Vec<u8>)>(
            "SELECT vault_id::text, applied_revision, note_id::text, base_revision, \
                ciphertext, nonce, ciphertext_hash \
             FROM operations WHERE id = $1::uuid",
        )
        .bind(operation_id.to_string())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|_| ApplyError::Database)?;
    if let Some((
        existing_vault_id,
        applied_revision,
        existing_note_id,
        existing_base_revision,
        existing_ciphertext,
        existing_nonce,
        existing_hash,
    )) = existing
    {
        let Some(revision) = applied_revision else {
            return Err(ApplyError::Database);
        };
        if existing_vault_id != vault_id.to_string() {
            return Err(ApplyError::NotFound);
        }
        let same_payload = existing_note_id == operation.note_id
            && existing_base_revision
                == i64::try_from(operation.base_revision).map_err(|_| ApplyError::Invalid)?
            && existing_ciphertext == operation.ciphertext
            && existing_nonce == operation.nonce
            && existing_hash == ciphertext_hash.as_bytes();
        if !same_payload {
            return Err(ApplyError::Invalid);
        }
        transaction
            .commit()
            .await
            .map_err(|_| ApplyError::Database)?;
        return Ok(PushAck {
            operation_id,
            revision,
            new_revision: false,
        });
    }

    if operation.base_revision
        != u64::try_from(current_revision).map_err(|_| ApplyError::Database)?
    {
        if operation.base_revision
            > u64::try_from(current_revision).map_err(|_| ApplyError::Database)?
        {
            return Err(ApplyError::RevisionMismatch);
        }
        // A zero base revision means "vault genesis": there is no previous
        // revision row to reference, so the conflict reports a null hash.
        let base_hash = if operation.base_revision == 0 {
            Vec::new()
        } else {
            revision_ciphertext_hash(&mut transaction, vault_id, operation.base_revision).await?
        };
        let remote_revision = u64::try_from(current_revision).map_err(|_| ApplyError::Database)?;
        let remote_hash =
            revision_ciphertext_hash(&mut transaction, vault_id, remote_revision).await?;
        return Err(ApplyError::Conflict(Box::new(Conflict {
            protocol_version: PROTOCOL_VERSION,
            operation_id: operation.operation_id,
            vault_id: operation.vault_id,
            note_id: operation.note_id,
            base_revision: operation.base_revision,
            remote_revision,
            base_ciphertext_hash: hex_hash(&base_hash),
            local_ciphertext_hash: operation.ciphertext_hash,
            remote_ciphertext_hash: hex_hash(&remote_hash),
        })));
    }

    // Serialize quota checks across all vaults owned by this account. Without
    // an account-scoped lock, concurrent pushes to separate vaults could each
    // observe spare capacity and exceed the quota together.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(user_id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApplyError::Database)?;
    let used_bytes = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(octet_length(operations.ciphertext) + octet_length(operations.nonce)), 0)::bigint \
         FROM operations \
         JOIN vaults ON vaults.id = operations.vault_id \
         WHERE vaults.owner_user_id = $1::uuid",
    )
    .bind(user_id.to_string())
    .fetch_one(&mut *transaction)
    .await
    .map_err(|_| ApplyError::Database)?;
    let incoming_bytes = i64::try_from(operation.ciphertext.len())
        .ok()
        .and_then(|ciphertext| {
            i64::try_from(operation.nonce.len())
                .ok()
                .and_then(|nonce| ciphertext.checked_add(nonce))
        })
        .ok_or(ApplyError::Invalid)?;
    if used_bytes > ACCOUNT_STORAGE_QUOTA_BYTES.saturating_sub(incoming_bytes) {
        return Err(ApplyError::QuotaExceeded);
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
        new_revision: true,
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

async fn revision_ciphertext_hash(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    vault_id: Uuid,
    revision: u64,
) -> Result<Vec<u8>, ApplyError> {
    sqlx::query_scalar(
        "SELECT ciphertext_hash FROM revisions WHERE vault_id = $1::uuid AND revision = $2",
    )
    .bind(vault_id.to_string())
    .bind(i64::try_from(revision).map_err(|_| ApplyError::Database)?)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| ApplyError::Database)?
    .ok_or(ApplyError::Database)
}

fn hex_hash(hash: &[u8]) -> String {
    if hash.is_empty() {
        return "00".repeat(32);
    }
    hash.iter().map(|byte| format!("{byte:02x}")).collect()
}
