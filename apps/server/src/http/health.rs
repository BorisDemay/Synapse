use axum::{Json, extract::State, http::StatusCode};
use serde::Serialize;

use crate::AppState;

#[derive(Serialize)]
pub struct HealthStatus {
    status: &'static str,
}

pub async fn live() -> Json<HealthStatus> {
    Json(HealthStatus { status: "ok" })
}

pub async fn ready(State(state): State<AppState>) -> Result<Json<HealthStatus>, StatusCode> {
    let Some(pool) = state.pool else {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    };

    let migration_present = sqlx::query_scalar::<_, bool>(
        "SELECT \
            to_regclass('public.users') IS NOT NULL \
            AND to_regclass('public.sessions') IS NOT NULL \
            AND to_regclass('public.invites') IS NOT NULL \
            AND to_regclass('public.vaults') IS NOT NULL \
            AND to_regclass('public.vault_members') IS NOT NULL \
            AND to_regclass('public.encrypted_vault_keys') IS NOT NULL \
            AND to_regclass('public.revisions') IS NOT NULL \
            AND to_regclass('public.operations') IS NOT NULL \
            AND to_regclass('public.sync_cursors') IS NOT NULL \
            AND to_regclass('public.blobs') IS NOT NULL",
    )
    .fetch_one(&pool)
    .await;

    match migration_present {
        Ok(true) => Ok(Json(HealthStatus { status: "ok" })),
        Ok(false) | Err(_) => Err(StatusCode::SERVICE_UNAVAILABLE),
    }
}
