use std::fmt;

use sqlx::PgPool;
use synapse_protocol::v1::{EncryptedPushOperation, PullResponse, SyncCursor};
use uuid::Uuid;

const CURSOR_LIFETIME_SQL: &str = "CURRENT_TIMESTAMP + INTERVAL '30 days'";
const PROTOCOL_VERSION: u8 = 1;

#[derive(Debug)]
pub enum PullError {
    CursorResnapshotRequired,
    Database,
    NotFound,
}

impl fmt::Display for PullError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::CursorResnapshotRequired => "sync cursor requires resnapshot",
            Self::Database => "sync pull database operation failed",
            Self::NotFound => "vault is not available",
        })
    }
}

impl std::error::Error for PullError {}

pub async fn pull(
    pool: &PgPool,
    user_id: Uuid,
    vault_id: Uuid,
    cursor: Option<&SyncCursor>,
    limit: u32,
) -> Result<PullResponse, PullError> {
    let is_member = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM vault_members WHERE vault_id = $1::uuid AND user_id = $2::uuid)",
    )
    .bind(vault_id.to_string())
    .bind(user_id.to_string())
    .fetch_one(pool)
    .await
    .map_err(|_| PullError::Database)?;
    if !is_member {
        return Err(PullError::NotFound);
    }

    let start_revision = match cursor {
        Some(cursor) => cursor_revision(pool, cursor, vault_id, user_id).await?,
        None => 0,
    };
    let retention_floor = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT MIN(revision) FROM revisions WHERE vault_id = $1::uuid",
    )
    .bind(vault_id.to_string())
    .fetch_one(pool)
    .await
    .map_err(|_| PullError::Database)?;
    if cursor.is_some() && retention_floor.is_some_and(|floor| start_revision < floor - 1) {
        return Err(PullError::CursorResnapshotRequired);
    }

    let rows = sqlx::query_as::<_, (String, String, i64, String, Vec<u8>, Vec<u8>, String, i64)>(
        "SELECT operations.id::text, operations.vault_id::text, operations.base_revision, \
                operations.note_id::text, operations.ciphertext, operations.nonce, \
                encode(operations.ciphertext_hash, 'hex'), revisions.revision \
         FROM revisions \
         JOIN operations ON operations.id = revisions.operation_id \
         WHERE revisions.vault_id = $1::uuid AND revisions.revision > $2 \
         ORDER BY revisions.revision ASC \
         LIMIT $3",
    )
    .bind(vault_id.to_string())
    .bind(start_revision)
    .bind(i64::from(limit))
    .fetch_all(pool)
    .await
    .map_err(|_| PullError::Database)?;

    let last_revision = rows.last().map(|row| row.7);
    let operations = rows
        .into_iter()
        .map(
            |(
                operation_id,
                operation_vault_id,
                base_revision,
                note_id,
                ciphertext,
                nonce,
                ciphertext_hash,
                _,
            )| {
                let base_revision =
                    u64::try_from(base_revision).map_err(|_| PullError::Database)?;
                Ok(EncryptedPushOperation {
                    protocol_version: PROTOCOL_VERSION,
                    operation_id,
                    vault_id: operation_vault_id,
                    note_id,
                    base_revision,
                    ciphertext,
                    nonce,
                    aad_version: PROTOCOL_VERSION,
                    ciphertext_hash,
                    encrypted_vault_key_envelope: None,
                })
            },
        )
        .collect::<Result<Vec<_>, PullError>>()?;
    let next_cursor = match last_revision {
        Some(revision) => Some(issue_cursor(pool, vault_id, user_id, revision).await?),
        None => None,
    };

    Ok(PullResponse {
        protocol_version: PROTOCOL_VERSION,
        operations,
        next_cursor,
    })
}

async fn cursor_revision(
    pool: &PgPool,
    cursor: &SyncCursor,
    vault_id: Uuid,
    user_id: Uuid,
) -> Result<i64, PullError> {
    sqlx::query_scalar(
        "SELECT revision FROM sync_cursors \
         WHERE id = $1::uuid AND vault_id = $2::uuid AND user_id = $3::uuid \
           AND expires_at > CURRENT_TIMESTAMP",
    )
    .bind(cursor.as_str())
    .bind(vault_id.to_string())
    .bind(user_id.to_string())
    .fetch_optional(pool)
    .await
    .map_err(|_| PullError::Database)?
    .ok_or(PullError::CursorResnapshotRequired)
}

async fn issue_cursor(
    pool: &PgPool,
    vault_id: Uuid,
    user_id: Uuid,
    revision: i64,
) -> Result<SyncCursor, PullError> {
    let cursor = Uuid::new_v4();
    sqlx::query(&format!(
        "INSERT INTO sync_cursors (id, vault_id, user_id, revision, expires_at) \
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, {CURSOR_LIFETIME_SQL})"
    ))
    .bind(cursor.to_string())
    .bind(vault_id.to_string())
    .bind(user_id.to_string())
    .bind(revision)
    .execute(pool)
    .await
    .map_err(|_| PullError::Database)?;
    SyncCursor::new(cursor.to_string()).map_err(|_| PullError::Database)
}
