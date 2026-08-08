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

fn session_token(headers: &HeaderMap) -> Option<session::SessionToken> {
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
