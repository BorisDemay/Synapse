pub mod auth;
pub mod blob;
pub mod config;
pub mod http;
pub mod metrics;
pub mod repository;
pub mod sync;
pub mod telemetry;

use std::{path::PathBuf, sync::Arc};

use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{get, post},
};
use sqlx::PgPool;
use tower_governor::{
    GovernorLayer, governor::GovernorConfigBuilder, key_extractor::GlobalKeyExtractor,
};

#[derive(Clone)]
pub struct AppState {
    pub(crate) pool: Option<PgPool>,
    pub(crate) blob_store: Option<Arc<dyn blob::BlobStore>>,
    pub(crate) allow_public_signup: bool,
    pub(crate) cookie_secure: bool,
    pub(crate) csrf_origin: String,
    pub(crate) enable_hsts: bool,
    pub(crate) clock: Arc<dyn auth::session::Clock>,
    pub(crate) notifications: http::ws::NotificationHub,
}

pub fn router(pool: Option<PgPool>) -> Router {
    router_with_clock_and_blob_store(
        pool,
        Arc::new(auth::session::SystemClock),
        default_blob_store(),
    )
}

pub fn router_with_clock(pool: Option<PgPool>, clock: Arc<dyn auth::session::Clock>) -> Router {
    router_with_clock_and_blob_store(pool, clock, default_blob_store())
}

pub fn router_with_blob_store(
    pool: Option<PgPool>,
    blob_store: impl blob::BlobStore + 'static,
) -> Router {
    router_with_clock_and_blob_store(
        pool,
        Arc::new(auth::session::SystemClock),
        Some(Arc::new(blob_store)),
    )
}

fn router_with_clock_and_blob_store(
    pool: Option<PgPool>,
    clock: Arc<dyn auth::session::Clock>,
    blob_store: Option<Arc<dyn blob::BlobStore>>,
) -> Router {
    router_with_settings(RouterSettings {
        allow_public_signup: matches!(
            std::env::var("SYNAPSE_ALLOW_PUBLIC_SIGNUP").as_deref(),
            Ok("true")
        ),
        blob_store,
        clock,
        cookie_secure: !matches!(
            std::env::var("SYNAPSE_COOKIE_SECURE").as_deref(),
            Ok("false")
        ),
        csrf_origin: std::env::var("SYNAPSE_ALLOWED_ORIGIN")
            .unwrap_or_else(|_| "https://synapse.local".to_owned()),
        enable_hsts: http::security::is_production(),
        pool,
    })
}

pub struct RouterSettings {
    pub allow_public_signup: bool,
    pub blob_store: Option<Arc<dyn blob::BlobStore>>,
    pub clock: Arc<dyn auth::session::Clock>,
    pub cookie_secure: bool,
    pub csrf_origin: String,
    pub enable_hsts: bool,
    pub pool: Option<PgPool>,
}

pub fn router_with_settings(settings: RouterSettings) -> Router {
    let state = AppState {
        pool: settings.pool,
        blob_store: settings.blob_store,
        allow_public_signup: settings.allow_public_signup,
        cookie_secure: settings.cookie_secure,
        csrf_origin: settings.csrf_origin,
        enable_hsts: settings.enable_hsts,
        clock: settings.clock,
        notifications: http::ws::NotificationHub::new(),
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
        .route("/metrics", get(metrics::render))
        .route("/auth/logout", post(http::auth::logout))
        .route("/v1/session", get(http::auth::session_info))
        .route("/vaults", post(http::vaults::create))
        .route("/vaults/{vault_id}", get(http::vaults::read))
        .route("/v1/vaults", get(http::vaults::list))
        .route(
            "/v1/vaults/{vault_id}/envelope",
            get(http::vaults::read_envelope).put(http::vaults::write_envelope),
        )
        .route("/v1/vaults/{vault_id}/ws", get(http::ws::connect))
        .route(
            "/v1/vaults/{vault_id}/operations",
            post(http::sync::push)
                .get(http::sync::pull)
                .layer(DefaultBodyLimit::max(http::sync::MAX_REQUEST_BYTES)),
        )
        .nest("/auth", auth_routes)
        .layer(axum::middleware::from_fn(telemetry::request_id_middleware))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            http::security::layer,
        ))
        .with_state(state)
}

fn default_blob_store() -> Option<Arc<dyn blob::BlobStore>> {
    let path = std::env::var_os("SYNAPSE_STORAGE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("synapse-blobs"));
    blob::FilesystemBlobStore::open(path)
        .ok()
        .map(|store| Arc::new(store) as Arc<dyn blob::BlobStore>)
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(include_str!("../../../migrations/0001_initial.sql"))
        .execute(pool)
        .await?;
    sqlx::raw_sql(include_str!(
        "../../../migrations/0002_add_user_admin_privilege.sql"
    ))
    .execute(pool)
    .await?;
    sqlx::raw_sql(include_str!(
        "../../../migrations/0003_enforce_vault_owner_membership.sql"
    ))
    .execute(pool)
    .await
    .map(|_| ())?;
    sqlx::raw_sql(include_str!(
        "../../../migrations/0004_persist_opaque_sync_cursors.sql"
    ))
    .execute(pool)
    .await
    .map(|_| ())?;
    sqlx::raw_sql(include_str!(
        "../../../migrations/0005_vault_user_envelopes.sql"
    ))
    .execute(pool)
    .await
    .map(|_| ())
}
