use std::sync::{Arc, OnceLock};

use axum::{
    Json,
    extract::Request,
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use synapse_protocol::v1::{MAX_PULL_LIMIT, ResnapshotRequired, SyncCursor};
use tokio::{
    sync::Semaphore,
    time::{Duration, timeout},
};
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
const SYNC_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CONCURRENT_SYNC_REQUESTS: usize = 4;

fn sync_gate() -> &'static Arc<Semaphore> {
    static GATE: OnceLock<Arc<Semaphore>> = OnceLock::new();
    GATE.get_or_init(|| Arc::new(Semaphore::new(MAX_CONCURRENT_SYNC_REQUESTS)))
}

fn acquire_sync_slot() -> Option<tokio::sync::OwnedSemaphorePermit> {
    sync_gate().clone().try_acquire_owned().ok()
}

/// Bound the whole request, including body extraction, before a handler can
/// allocate a decoded operation or query the database. The permit is held
/// until the response body is ready, so slow uploads cannot bypass the global
/// synchronization limit.
pub async fn limits(request: Request, next: Next) -> Response {
    let Some(_slot) = acquire_sync_slot() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match timeout(SYNC_REQUEST_TIMEOUT, next.run(request)).await {
        Ok(response) => response,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

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
    if !crate::http::security::required_origin_allowed(&headers, &state.allowed_origins) {
        return StatusCode::FORBIDDEN.into_response();
    }
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
    let result = timeout(
        SYNC_REQUEST_TIMEOUT,
        apply::apply(&pool, blob_store.as_ref(), user_id, vault_id, operation),
    )
    .await;
    match result {
        Err(_) => {
            crate::metrics::observe_push_error();
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
        Ok(Ok(ack)) => {
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
        Ok(Err(ApplyError::Conflict(conflict))) => {
            crate::metrics::observe_push_conflict();
            (StatusCode::CONFLICT, Json(*conflict)).into_response()
        }
        Ok(Err(error)) => {
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

    let result = timeout(
        SYNC_REQUEST_TIMEOUT,
        pull::pull(
            &pool,
            user_id,
            route_vault_id,
            request.cursor.as_ref(),
            request.limit,
        ),
    )
    .await;
    match result {
        Ok(Ok(response)) => {
            crate::metrics::observe_pull();
            Json(response).into_response()
        }
        Ok(Err(PullError::CursorResnapshotRequired)) => {
            (StatusCode::CONFLICT, Json(ResnapshotRequired::new())).into_response()
        }
        Ok(Err(PullError::NotFound)) => StatusCode::NOT_FOUND.into_response(),
        Ok(Err(PullError::Database)) | Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

fn status_for(error: ApplyError) -> StatusCode {
    match error {
        ApplyError::Conflict(_) => StatusCode::CONFLICT,
        ApplyError::RevisionMismatch => StatusCode::CONFLICT,
        ApplyError::Invalid => StatusCode::BAD_REQUEST,
        ApplyError::NotFound => StatusCode::NOT_FOUND,
        ApplyError::QuotaExceeded => StatusCode::INSUFFICIENT_STORAGE,
        ApplyError::Database | ApplyError::Storage => StatusCode::SERVICE_UNAVAILABLE,
    }
}
