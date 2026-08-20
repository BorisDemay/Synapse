use axum::{
    Json,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use synapse_protocol::v1::{MAX_PULL_LIMIT, ResnapshotRequired, SyncCursor};
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

pub const MAX_REQUEST_BYTES: usize = apply::MAX_CIPHERTEXT_BYTES * 5 + 32_768;

#[derive(Serialize)]
pub struct PushAckResponse {
    operation_id: String,
    revision: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullQuery {
    cursor: Option<SyncCursor>,
    limit: u32,
}

pub async fn push(
    State(state): State<AppState>,
    Path(vault_id): Path<String>,
    headers: HeaderMap,
    operation: Result<Json<PushOperation>, JsonRejection>,
) -> Response {
    let Json(operation) = match operation {
        Ok(operation) => operation,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let vault_id = match Uuid::parse_str(&vault_id) {
        Ok(vault_id) => vault_id,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let Some(pool) = state.pool.clone() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Some(blob_store) = state.blob_store.clone() else {
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
    match apply::apply(&pool, blob_store.as_ref(), user_id, vault_id, operation).await {
        Ok(ack) => {
            if ack.new_revision {
                state.notifications.publish(vault_id, ack.revision);
            }
            crate::metrics::observe_push_accepted();
            (
                StatusCode::CREATED,
                Json(PushAckResponse {
                    operation_id: ack.operation_id.to_string(),
                    revision: ack.revision,
                }),
            )
                .into_response()
        }
        Err(ApplyError::Conflict(conflict)) => {
            crate::metrics::observe_push_conflict();
            (StatusCode::CONFLICT, Json(*conflict)).into_response()
        }
        Err(error) => {
            crate::metrics::observe_push_error();
            status_for(error).into_response()
        }
    }
}

pub async fn pull(
    State(state): State<AppState>,
    Path(vault_id): Path<String>,
    headers: HeaderMap,
    request: Result<Query<PullQuery>, QueryRejection>,
) -> Response {
    let Query(request) = match request {
        Ok(request) => request,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let route_vault_id = match Uuid::parse_str(&vault_id) {
        Ok(vault_id) => vault_id,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    if request.limit == 0 || request.limit > MAX_PULL_LIMIT {
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
        Ok(response) => {
            crate::metrics::observe_pull();
            Json(response).into_response()
        }
        Err(PullError::CursorResnapshotRequired) => {
            (StatusCode::CONFLICT, Json(ResnapshotRequired::new())).into_response()
        }
        Err(PullError::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(PullError::Database) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

fn status_for(error: ApplyError) -> StatusCode {
    match error {
        ApplyError::Conflict(_) => StatusCode::CONFLICT,
        ApplyError::RevisionMismatch => StatusCode::CONFLICT,
        ApplyError::Invalid => StatusCode::BAD_REQUEST,
        ApplyError::NotFound => StatusCode::NOT_FOUND,
        ApplyError::Database | ApplyError::Storage => StatusCode::SERVICE_UNAVAILABLE,
    }
}
