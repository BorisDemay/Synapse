use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use serde::Serialize;

use crate::{AppState, auth::session, http::vaults, sync::apply::ACCOUNT_STORAGE_QUOTA_BYTES};

#[derive(Serialize)]
pub struct StorageStatus {
    pub available_bytes: i64,
    pub pending_operation_count: i64,
    pub quota_bytes: i64,
    pub used_bytes: i64,
    pub last_successful_backup: Option<String>,
}

pub async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<StorageStatus>, StatusCode> {
    let pool = state.pool.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let token = vaults::session_token(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id = session::user_for(pool, &token, state.clock.now())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let used_bytes = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(octet_length(operations.ciphertext) + octet_length(operations.nonce)), 0)::bigint \
         FROM operations \
         JOIN vaults ON vaults.id = operations.vault_id \
         WHERE vaults.owner_user_id = $1::uuid",
    )
    .bind(user_id.to_string())
    .fetch_one(pool)
    .await
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let pending_operation_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM operations \
         JOIN vaults ON vaults.id = operations.vault_id \
         WHERE vaults.owner_user_id = $1::uuid AND operations.applied_revision IS NULL",
    )
    .bind(user_id.to_string())
    .fetch_one(pool)
    .await
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let available_bytes = ACCOUNT_STORAGE_QUOTA_BYTES.saturating_sub(used_bytes.max(0));
    let last_successful_backup = std::env::var("SYNAPSE_LAST_BACKUP_AT")
        .ok()
        .filter(|value| {
            !value.is_empty() && value.len() <= 64 && !value.bytes().any(|byte| byte < 0x20)
        });
    Ok(Json(StorageStatus {
        available_bytes,
        pending_operation_count,
        quota_bytes: ACCOUNT_STORAGE_QUOTA_BYTES,
        used_bytes,
        last_successful_backup,
    }))
}
