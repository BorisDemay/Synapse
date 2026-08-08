pub mod auth;
pub mod config;
pub mod http;

use std::sync::{Arc, Mutex};

use axum::{
    Router, middleware,
    routing::{get, post},
};
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub(crate) pool: Option<PgPool>,
    pub(crate) allow_public_signup: bool,
    pub(crate) csrf_origin: String,
    pub(crate) rate_limit: Arc<Mutex<http::auth::AuthRateLimit>>,
    pub(crate) clock: Arc<dyn auth::session::Clock>,
}

pub fn router(pool: Option<PgPool>) -> Router {
    router_with_clock(pool, Arc::new(auth::session::SystemClock))
}

pub fn router_with_clock(pool: Option<PgPool>, clock: Arc<dyn auth::session::Clock>) -> Router {
    let state = AppState {
        pool,
        allow_public_signup: matches!(
            std::env::var("SYNAPSE_ALLOW_PUBLIC_SIGNUP").as_deref(),
            Ok("true")
        ),
        csrf_origin: std::env::var("SYNAPSE_ALLOWED_ORIGIN")
            .unwrap_or_else(|_| "https://synapse.local".to_owned()),
        rate_limit: Arc::new(http::auth::new_rate_limit()),
        clock,
    };

    let auth_routes = Router::new()
        .route("/signup", post(http::auth::signup))
        .route("/login", post(http::auth::login))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            http::auth::rate_limit,
        ));

    Router::new()
        .route("/health/live", get(http::health::live))
        .route("/health/ready", get(http::health::ready))
        .route("/auth/logout", post(http::auth::logout))
        .nest("/auth", auth_routes)
        .with_state(state)
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(include_str!("../../../migrations/0001_initial.sql"))
        .execute(pool)
        .await
        .map(|_| ())
}
