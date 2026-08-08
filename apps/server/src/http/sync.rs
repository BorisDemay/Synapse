use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use synapse_protocol::v1::{PullRequest, ResnapshotRequired};
use uuid::Uuid;

use crate::{
    AppState,
    auth::session,
    http::vaults,
    sync::{
        apply::{self, ApplyError, PushOperation},
        pull::{self, PullError},
    },
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

pub async fn pull(
    State(state): State<AppState>,
    Path(vault_id): Path<String>,
    headers: HeaderMap,
    request: Result<Json<PullRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let route_vault_id = match Uuid::parse_str(&vault_id) {
        Ok(vault_id) => vault_id,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    if request.vault_id != route_vault_id.to_string() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Some(pool) = state.pool else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Some(token) = vaults::session_token(&headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let user_id = match session::user_for(&pool, &token, state.clock.now()).await {
        Ok(Some(user_id)) => user_id,
        Ok(None) => return StatusCode::UNAUTHORIZED.into_response(),
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };

    match pull::pull(
        &pool,
        user_id,
        route_vault_id,
        request.cursor.as_ref(),
        request.limit,
    )
    .await
    {
        Ok(response) => Json(response).into_response(),
        Err(PullError::CursorResnapshotRequired) => {
            (StatusCode::CONFLICT, Json(ResnapshotRequired::new())).into_response()
        }
        Err(PullError::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(PullError::Database) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

fn status_for(error: ApplyError) -> StatusCode {
    match error {
        ApplyError::Conflict => StatusCode::CONFLICT,
        ApplyError::Invalid => StatusCode::BAD_REQUEST,
        ApplyError::NotFound => StatusCode::NOT_FOUND,
        ApplyError::Database | ApplyError::Storage => StatusCode::SERVICE_UNAVAILABLE,
    }
}
