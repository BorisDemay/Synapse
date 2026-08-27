use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
};
use serde::{Deserialize, Serialize};

use crate::{AppState, auth::session, repository::vaults};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateVaultRequest {}

#[derive(Serialize)]
pub struct CreateVaultResponse {
    id: String,
}

const MAX_ENVELOPE_BYTES: usize = 64 * 1024;

#[derive(Serialize)]
pub struct VaultListResponse {
    vaults: Vec<CreateVaultResponse>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EnvelopeRequest {
    bytes: Vec<u8>,
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(_request): Json<CreateVaultRequest>,
) -> Result<(StatusCode, Json<CreateVaultResponse>), StatusCode> {
    let pool = state.pool.ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let token = session_token(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id = session::user_for(&pool, &token, state.clock.now())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let vault_id = vaults::create_for_owner(&pool, user_id)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;

    Ok((
        StatusCode::CREATED,
        Json(CreateVaultResponse {
            id: vault_id.to_string(),
        }),
    ))
}

pub async fn read(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(vault_id): Path<String>,
) -> Result<Json<CreateVaultResponse>, StatusCode> {
    let vault_id = uuid::Uuid::parse_str(&vault_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let pool = state.pool.ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let token = session_token(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id = session::user_for(&pool, &token, state.clock.now())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let vault_id = vaults::find_owned(&pool, vault_id, user_id)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(CreateVaultResponse {
        id: vault_id.to_string(),
    }))
}

pub(crate) fn session_token(headers: &HeaderMap) -> Option<session::SessionToken> {
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies
                .split(';')
                .map(str::trim)
                .find_map(|part| part.strip_prefix("session="))
        })
        .and_then(session::SessionToken::parse)
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<VaultListResponse>, StatusCode> {
    let pool = state.pool.ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let token = session_token(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id = session::user_for(&pool, &token, state.clock.now())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let ids = sqlx::query_scalar::<_, String>(
        "SELECT vault_id::text FROM vault_members WHERE user_id = $1::uuid ORDER BY vault_id",
    )
    .bind(user_id.to_string())
    .fetch_all(&pool)
    .await
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(Json(VaultListResponse {
        vaults: ids
            .into_iter()
            .map(|id| CreateVaultResponse { id })
            .collect(),
    }))
}

pub async fn read_envelope(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(vault_id): Path<String>,
) -> Result<Json<EnvelopeRequest>, StatusCode> {
    let vault_id = uuid::Uuid::parse_str(&vault_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let pool = state.pool.ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let token = session_token(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id = session::user_for(&pool, &token, state.clock.now())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let bytes = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT bytes FROM vault_user_envelopes WHERE vault_id = $1::uuid AND user_id = $2::uuid",
    )
    .bind(vault_id.to_string())
    .bind(user_id.to_string())
    .fetch_optional(&pool)
    .await
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
    .ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(EnvelopeRequest { bytes }))
}

pub async fn write_envelope(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(vault_id): Path<String>,
    payload: Result<Json<EnvelopeRequest>, axum::extract::rejection::JsonRejection>,
) -> StatusCode {
    if !headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|origin| crate::http::security::origin_allowed(&state.allowed_origins, origin))
    {
        return StatusCode::FORBIDDEN;
    }
    let Ok(Json(payload)) = payload else {
        return StatusCode::BAD_REQUEST;
    };
    if payload.bytes.is_empty() || payload.bytes.len() > MAX_ENVELOPE_BYTES {
        return StatusCode::BAD_REQUEST;
    }
    let Ok(vault_id) = uuid::Uuid::parse_str(&vault_id) else {
        return StatusCode::BAD_REQUEST;
    };
    let Some(pool) = state.pool else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let Some(token) = session_token(&headers) else {
        return StatusCode::UNAUTHORIZED;
    };
    let user_id = match session::user_for(&pool, &token, state.clock.now()).await {
        Ok(Some(id)) => id,
        Ok(None) => return StatusCode::UNAUTHORIZED,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE,
    };
    let member = sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM vault_members WHERE vault_id = $1::uuid AND user_id = $2::uuid)")
        .bind(vault_id.to_string()).bind(user_id.to_string()).fetch_one(&pool).await;
    if !matches!(member, Ok(true)) {
        return if member.is_ok() {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        };
    }
    match sqlx::query("INSERT INTO vault_user_envelopes (vault_id, user_id, bytes) VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT (vault_id, user_id) DO UPDATE SET bytes = EXCLUDED.bytes, updated_at = CURRENT_TIMESTAMP")
        .bind(vault_id.to_string()).bind(user_id.to_string()).bind(payload.bytes).execute(&pool).await { Ok(_) => StatusCode::NO_CONTENT, Err(_) => StatusCode::SERVICE_UNAVAILABLE }
}
