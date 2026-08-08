pub mod config;
pub mod http;

use axum::{Router, routing::get};
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pool: Option<PgPool>,
}

pub fn router(pool: Option<PgPool>) -> Router {
    let state = AppState { pool };

    Router::new()
        .route("/health/live", get(http::health::live))
        .route("/health/ready", get(http::health::ready))
        .with_state(state)
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(include_str!("../../../migrations/0001_initial.sql"))
        .execute(pool)
        .await
        .map(|_| ())
}
