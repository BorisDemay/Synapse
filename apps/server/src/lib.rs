pub mod auth;
pub mod blob;
pub mod config;
pub mod http;
pub mod metrics;
pub mod repository;
pub mod sync;
pub mod telemetry;

use std::{
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{get, post},
};
use ipnet::IpNet;
use sqlx::PgPool;
use tower_governor::{GovernorLayer, governor::GovernorConfigBuilder, key_extractor::KeyExtractor};

#[derive(Clone, Debug)]
struct ClientKeyExtractor {
    trusted_proxies: Arc<[IpNet]>,
}

impl KeyExtractor for ClientKeyExtractor {
    type Key = String;

    fn extract<T>(
        &self,
        request: &axum::http::Request<T>,
    ) -> Result<Self::Key, tower_governor::GovernorError> {
        let peer = request
            .extensions()
            .get::<axum::extract::ConnectInfo<SocketAddr>>()
            .map(|info| info.0.ip());
        let client = match peer {
            Some(peer)
                if self
                    .trusted_proxies
                    .iter()
                    .any(|network| network.contains(&peer)) =>
            {
                forwarded_client(request, &self.trusted_proxies).unwrap_or(peer)
            }
            Some(peer) => peer,
            // Requests without transport metadata are treated as one local
            // client. Never trust a forwarding header when the peer address is
            // unavailable; production listeners install ConnectInfo in main.
            None => IpAddr::from([0, 0, 0, 0]),
        };
        Ok(client.to_string())
    }
}

fn forwarded_client<T>(
    request: &axum::http::Request<T>,
    trusted_proxies: &[IpNet],
) -> Option<IpAddr> {
    request
        .headers()
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(',')
                .rev()
                .filter_map(|candidate| candidate.trim().parse::<IpAddr>().ok())
                .find(|candidate| {
                    !trusted_proxies
                        .iter()
                        .any(|network| network.contains(candidate))
                })
        })
}

fn configured_trusted_proxies() -> Arc<[IpNet]> {
    std::env::var("SYNAPSE_TRUSTED_PROXIES")
        .ok()
        .map(|value| {
            value
                .split(',')
                .filter_map(|entry| entry.trim().parse::<IpNet>().ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
        .into()
}

#[derive(Clone)]
pub struct AppState {
    pub(crate) pool: Option<PgPool>,
    pub(crate) blob_store: Option<Arc<dyn blob::BlobStore>>,
    pub(crate) allow_public_signup: bool,
    pub(crate) cookie_secure: bool,
    pub(crate) allowed_origins: Arc<[String]>,
    pub(crate) enable_hsts: bool,
    pub(crate) clock: Arc<dyn auth::session::Clock>,
    pub(crate) mailer: Arc<dyn auth::mail::Mailer>,
    pub(crate) public_origin: String,
    pub(crate) notifications: http::ws::NotificationHub,
    pub(crate) websocket_heartbeat_interval: Duration,
}

pub fn router(pool: Option<PgPool>) -> Router {
    router_with_clock_and_blob_store(
        pool,
        Arc::new(auth::session::SystemClock),
        default_blob_store(),
    )
}

/// Builds a router with a test-only WebSocket heartbeat cadence.
pub fn router_with_websocket_heartbeat(
    pool: Option<PgPool>,
    websocket_heartbeat_interval: Duration,
) -> Router {
    router_with_clock_and_blob_store_and_heartbeat(
        pool,
        Arc::new(auth::session::SystemClock),
        default_blob_store(),
        websocket_heartbeat_interval,
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
    router_with_clock_and_blob_store_and_heartbeat(pool, clock, blob_store, Duration::from_secs(30))
}

fn router_with_clock_and_blob_store_and_heartbeat(
    pool: Option<PgPool>,
    clock: Arc<dyn auth::session::Clock>,
    blob_store: Option<Arc<dyn blob::BlobStore>>,
    websocket_heartbeat_interval: Duration,
) -> Router {
    router_with_settings_and_heartbeat(
        RouterSettings {
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
            mailer: auth::mail::mailer_from_env(),
            pool,
            public_origin: std::env::var("SYNAPSE_ALLOWED_ORIGIN")
                .unwrap_or_else(|_| "https://synapse.local".to_owned()),
        },
        websocket_heartbeat_interval,
    )
}

pub struct RouterSettings {
    pub allow_public_signup: bool,
    pub blob_store: Option<Arc<dyn blob::BlobStore>>,
    pub clock: Arc<dyn auth::session::Clock>,
    pub cookie_secure: bool,
    pub csrf_origin: String,
    pub enable_hsts: bool,
    pub mailer: Arc<dyn auth::mail::Mailer>,
    pub pool: Option<PgPool>,
    pub public_origin: String,
}

pub fn router_with_settings(settings: RouterSettings) -> Router {
    router_with_settings_and_heartbeat(settings, Duration::from_secs(30))
}

fn router_with_settings_and_heartbeat(
    settings: RouterSettings,
    websocket_heartbeat_interval: Duration,
) -> Router {
    let allowed_origins =
        Arc::from(http::security::expand_allowed_origins(&settings.csrf_origin).into_boxed_slice());
    let state = AppState {
        pool: settings.pool,
        blob_store: settings.blob_store,
        allow_public_signup: settings.allow_public_signup,
        cookie_secure: settings.cookie_secure,
        allowed_origins,
        enable_hsts: settings.enable_hsts,
        clock: settings.clock,
        mailer: settings.mailer,
        public_origin: settings.public_origin,
        notifications: http::ws::NotificationHub::new(),
        websocket_heartbeat_interval,
    };

    let trusted_proxies = configured_trusted_proxies();
    let rate_limit_config = || {
        let mut config = GovernorConfigBuilder::default().key_extractor(ClientKeyExtractor {
            trusted_proxies: trusted_proxies.clone(),
        });
        config.per_second(1).burst_size(5);
        config
            .finish()
            .expect("a non-zero auth rate limit configuration is valid")
    };

    let credential_routes = Router::new()
        .route("/signup", post(http::auth::signup))
        .route("/login", post(http::auth::login))
        .layer(DefaultBodyLimit::max(128 * 1024))
        .layer(GovernorLayer::new(rate_limit_config()));
    let account_routes = Router::new()
        .route("/activate", post(http::auth::activate))
        .route("/password", post(http::auth::change_password))
        .route("/account/delete", post(http::auth::delete_account))
        .layer(DefaultBodyLimit::max(128 * 1024))
        .layer(GovernorLayer::new(rate_limit_config()));
    let auth_routes = Router::new()
        .route("/signup", get(http::auth::signup_status))
        .merge(credential_routes)
        .merge(account_routes);

    Router::new()
        .route("/health/live", get(http::health::live))
        .route("/health/ready", get(http::health::ready))
        .route("/health/version", get(http::health::version))
        .route("/health/storage", get(http::storage::status))
        .route("/metrics", get(metrics::render))
        .route("/auth/logout", post(http::auth::logout))
        .route("/auth/sessions", get(http::auth::list_sessions))
        .route("/auth/users", get(http::auth::list_users))
        .route("/auth/invitations", post(http::auth::create_invitation))
        .route(
            "/auth/sessions/revoke-others",
            post(http::auth::revoke_other_sessions),
        )
        .route(
            "/auth/sessions/{session_id}/revoke",
            post(http::auth::revoke_session),
        )
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
                .layer::<_, std::convert::Infallible>(axum::middleware::from_fn(http::sync::limits))
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
    .map(|_| ())?;
    sqlx::raw_sql(include_str!(
        "../../../migrations/0006_account_activation.sql"
    ))
    .execute(pool)
    .await
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::ConnectInfo;
    use axum::http::Request;

    #[test]
    fn rate_limit_key_ignores_forwarded_headers_from_direct_peers() {
        let extractor = ClientKeyExtractor {
            trusted_proxies: Arc::from(
                vec!["10.0.0.0/8".parse::<IpNet>().expect("network")].into_boxed_slice(),
            ),
        };
        let mut request = Request::new(());
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([192, 0, 2, 1], 443))));
        request
            .headers_mut()
            .insert("x-forwarded-for", "198.51.100.7".parse().unwrap());
        assert_eq!(extractor.extract(&request).unwrap(), "192.0.2.1");
    }

    #[test]
    fn trusted_proxy_forwarding_selects_the_first_untrusted_hop() {
        let extractor = ClientKeyExtractor {
            trusted_proxies: Arc::from(
                vec!["10.0.0.0/8".parse::<IpNet>().expect("network")].into_boxed_slice(),
            ),
        };
        let mut request = Request::new(());
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([10, 0, 0, 2], 443))));
        request
            .headers_mut()
            .insert("x-forwarded-for", "198.51.100.7, 10.0.0.3".parse().unwrap());
        assert_eq!(extractor.extract(&request).unwrap(), "198.51.100.7");
    }
}
