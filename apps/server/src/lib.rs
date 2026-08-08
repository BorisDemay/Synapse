pub mod auth;
pub mod config;
pub mod http;

use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
};
use sqlx::PgPool;
use tower_governor::{
    GovernorLayer, governor::GovernorConfigBuilder, key_extractor::GlobalKeyExtractor,
};

#[derive(Clone)]
pub struct AppState {
    pub(crate) pool: Option<PgPool>,
    pub(crate) allow_public_signup: bool,
    pub(crate) csrf_origin: String,
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
        clock,
    };

    let mut rate_limit_config = GovernorConfigBuilder::default().key_extractor(GlobalKeyExtractor);
    rate_limit_config.per_second(1).burst_size(5);
    let rate_limit_config = rate_limit_config
        .finish()
        .expect("a non-zero auth rate limit configuration is valid");

    let auth_routes = Router::new()
        .route("/signup", post(http::auth::signup))
        .route("/login", post(http::auth::login))
        .layer(GovernorLayer::new(rate_limit_config));

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
        .await?;
    sqlx::raw_sql(include_str!(
        "../../../migrations/0002_add_user_admin_privilege.sql"
    ))
    .execute(pool)
    .await
    .map(|_| ())
}
