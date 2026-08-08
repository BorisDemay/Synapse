use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    AppState,
    auth::session,
    http::vaults,
    sync::apply::{self, ApplyError, PushOperation},
};

pub const MAX_REQUEST_BYTES: usize = apply::MAX_CIPHERTEXT_BYTES + 16_384;

#[derive(Serialize)]
pub struct PushAckResponse {
    operation_id: String,
    revision: i64,
}

pub async fn push(
    State(state): State<AppState>,
    Path(vault_id): Path<String>,
    headers: HeaderMap,
    operation: Result<Json<PushOperation>, JsonRejection>,
) -> Result<(StatusCode, Json<PushAckResponse>), StatusCode> {
    let Json(operation) = operation.map_err(|_| StatusCode::BAD_REQUEST)?;
    let vault_id = Uuid::parse_str(&vault_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let pool = state.pool.ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let blob_store = state.blob_store.ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let token = vaults::session_token(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id = session::user_for(&pool, &token, state.clock.now())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let ack = apply::apply(&pool, blob_store.as_ref(), user_id, vault_id, operation)
        .await
        .map_err(status_for)?;

    Ok((
        StatusCode::CREATED,
        Json(PushAckResponse {
            operation_id: ack.operation_id.to_string(),
            revision: ack.revision,
        }),
    ))
}

fn status_for(error: ApplyError) -> StatusCode {
    match error {
        ApplyError::Conflict => StatusCode::CONFLICT,
        ApplyError::Invalid => StatusCode::BAD_REQUEST,
        ApplyError::NotFound => StatusCode::NOT_FOUND,
        ApplyError::Database | ApplyError::Storage => StatusCode::SERVICE_UNAVAILABLE,
    }
}
