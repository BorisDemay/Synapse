use std::{
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use http_body_util::BodyExt;
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use synapse_server::auth::session::Clock;
use tower::ServiceExt;
use uuid::Uuid;

struct TestClock(Mutex<SystemTime>);

impl TestClock {
    fn new(now: SystemTime) -> Self {
        Self(Mutex::new(now))
    }

    fn advance(&self, duration: Duration) {
        let mut now = self.0.lock().expect("test clock is available");
        *now += duration;
    }
}

impl synapse_server::auth::session::Clock for TestClock {
    fn now(&self) -> SystemTime {
        *self.0.lock().expect("test clock is available")
    }
}

async fn auth_test_lock() -> tokio::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

#[tokio::test]
async fn signup_rejects_malformed_json() {
    let response = synapse_server::router(None)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/signup")
                .header("content-type", "application/json")
                .body(Body::from("not-json"))
                .expect("the request is valid"),
        )
        .await
        .expect("the router responds");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn password_hash_is_argon2id_salted_and_verifiable() {
    let first =
        synapse_server::auth::password::hash("a secure password").expect("password is valid");
    let second =
        synapse_server::auth::password::hash("a secure password").expect("password is valid");

    assert!(first.starts_with("$argon2id$"));
    assert_ne!(first, "a secure password");
    assert_ne!(first, second);
    assert!(synapse_server::auth::password::verify("a secure password", &first).is_ok());
    assert!(synapse_server::auth::password::verify("wrong password", &first).is_err());
}

#[tokio::test]
async fn configured_bootstrap_creates_one_persistent_administrator_without_replacing_it() {
    let _guard = auth_test_lock().await;
    let pool = test_pool().await;
    reset_auth_tables(&pool).await;

    let mut initial_server =
        configured_server("initial-admin@example.test", "initial bootstrap password");
    let initial = wait_for_user(&pool, "initial-admin@example.test").await;
    initial_server.kill().expect("initial server stops");
    initial_server.wait().expect("initial server exits");
    let initial_hash = String::from_utf8(initial.1.clone()).expect("password hash is text");
    assert!(initial_hash.starts_with("$argon2id$"));
    assert!(
        synapse_server::auth::password::verify("initial bootstrap password", &initial_hash).is_ok()
    );

    assert!(initial.2, "the bootstrap account is an administrator");

    let mut replacement_server = configured_server(
        "replacement-admin@example.test",
        "replacement bootstrap password",
    );
    std::thread::sleep(Duration::from_millis(100));
    replacement_server.kill().expect("replacement server stops");
    replacement_server.wait().expect("replacement server exits");
    let stored: (String, Vec<u8>, bool) =
        sqlx::query_as("SELECT id::text, password_hash, is_admin FROM users")
            .fetch_one(&pool)
            .await
            .expect("administrator remains stored");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users")
            .fetch_one(&pool)
            .await
            .expect("user count"),
        1
    );
    assert_eq!(stored, initial);
}

#[tokio::test]
async fn signup_login_session_revocation_expiration_and_csrf_are_enforced() {
    let _guard = auth_test_lock().await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect("postgres://postgres@127.0.0.1:55432/synapse_test")
        .await
        .expect("test postgres is available");
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    sqlx::query("TRUNCATE sessions, invites, users CASCADE")
        .execute(&pool)
        .await
        .expect("auth tables reset");

    let invite_token = "valid-invitation-token";
    sqlx::query("INSERT INTO invites (id, email, token_hash, expires_at) VALUES ($1::uuid, $2, $3, CURRENT_TIMESTAMP + INTERVAL '1 hour')")
        .bind(Uuid::new_v4().to_string())
        .bind("person@example.test")
        .bind(Sha256::digest(invite_token.as_bytes()).to_vec())
        .execute(&pool)
        .await
        .expect("invitation is stored");

    let app = synapse_server::router(Some(pool.clone()));
    let no_invite = request_json(
        "/auth/signup",
        r#"{"email":"person@example.test","password":"a secure password"}"#,
    );
    assert_eq!(
        app.clone()
            .oneshot(no_invite)
            .await
            .expect("response")
            .status(),
        StatusCode::BAD_REQUEST
    );

    let signup = request_json(
        "/auth/signup",
        r#"{"email":" Person@Example.Test ","password":"a secure password","invitation_token":"valid-invitation-token"}"#,
    );
    assert_eq!(
        app.clone()
            .oneshot(signup)
            .await
            .expect("response")
            .status(),
        StatusCode::CREATED
    );
    let stored_email: String = sqlx::query_scalar("SELECT email FROM users")
        .fetch_one(&pool)
        .await
        .expect("user exists");
    assert_eq!(stored_email, "person@example.test");
    assert!(
        !sqlx::query_scalar::<_, bool>("SELECT is_admin FROM users WHERE email = $1")
            .bind("person@example.test")
            .fetch_one(&pool)
            .await
            .expect("ordinary signup has no global administrator privilege")
    );

    let duplicate = request_json(
        "/auth/signup",
        r#"{"email":"person@example.test","password":"a secure password","invitation_token":"valid-invitation-token"}"#,
    );
    assert_eq!(
        app.clone()
            .oneshot(duplicate)
            .await
            .expect("response")
            .status(),
        StatusCode::BAD_REQUEST
    );

    let login = request_json(
        "/auth/login",
        r#"{"email":"person@example.test","password":"a secure password"}"#,
    );
    let response = app.clone().oneshot(login).await.expect("response");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .expect("session cookie")
        .to_str()
        .expect("valid cookie");
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("Secure"));
    assert!(cookie.contains("SameSite=Strict"));
    let raw_token = cookie.split(';').next().expect("cookie pair");
    let token_bytes = URL_SAFE_NO_PAD
        .decode(raw_token.strip_prefix("session=").expect("token"))
        .expect("opaque token encoding");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sessions WHERE token_hash = $1")
            .bind(Sha256::digest(token_bytes).to_vec())
            .fetch_one(&pool)
            .await
            .expect("session count"),
        1
    );

    let cross_site = Request::builder()
        .method("POST")
        .uri("/auth/logout")
        .header(header::COOKIE, raw_token)
        .header(header::ORIGIN, "https://evil.example")
        .body(Body::empty())
        .expect("request");
    assert_eq!(
        app.clone()
            .oneshot(cross_site)
            .await
            .expect("response")
            .status(),
        StatusCode::FORBIDDEN
    );
    let logout = Request::builder()
        .method("POST")
        .uri("/auth/logout")
        .header(header::COOKIE, raw_token)
        .header(header::ORIGIN, "https://synapse.local")
        .body(Body::empty())
        .expect("request");
    assert_eq!(
        app.clone()
            .oneshot(logout)
            .await
            .expect("response")
            .status(),
        StatusCode::NO_CONTENT
    );

    let user_id = Uuid::parse_str(
        &sqlx::query_scalar::<_, String>("SELECT id::text FROM users")
            .fetch_one(&pool)
            .await
            .expect("user id"),
    )
    .expect("uuid");
    let token =
        synapse_server::auth::session::create(&pool, user_id, UNIX_EPOCH + Duration::from_secs(10))
            .await
            .expect("session created");
    assert!(
        synapse_server::auth::session::user_for(
            &pool,
            &token,
            UNIX_EPOCH + Duration::from_secs(10 + 8 * 3600 - 1)
        )
        .await
        .expect("lookup")
        .is_some()
    );
    assert!(
        synapse_server::auth::session::user_for(
            &pool,
            &token,
            UNIX_EPOCH + Duration::from_secs(10 + 8 * 3600)
        )
        .await
        .expect("lookup")
        .is_none()
    );
}

#[tokio::test]
async fn authenticated_session_introspection_returns_only_its_opaque_user_id() {
    let _guard = auth_test_lock().await;
    let pool = test_pool().await;
    reset_auth_tables(&pool).await;
    let user_id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id, email, password_hash) VALUES ($1::uuid, $2, $3)")
        .bind(user_id.to_string())
        .bind("session@example.test")
        .bind(b"not-used-by-this-test".as_slice())
        .execute(&pool)
        .await
        .expect("user is stored");
    let session = synapse_server::auth::session::create(&pool, user_id, SystemTime::now())
        .await
        .expect("session is created");
    let app = synapse_server::router(Some(pool));

    let authenticated = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/session")
                .header(
                    header::COOKIE,
                    format!("session={}", session.cookie_value()),
                )
                .body(Body::empty())
                .expect("request is valid"),
        )
        .await
        .expect("response");
    assert_eq!(authenticated.status(), StatusCode::OK);
    assert_eq!(
        authenticated
            .into_body()
            .collect()
            .await
            .expect("body is readable")
            .to_bytes(),
        format!(r#"{{"user_id":"{user_id}"}}"#)
    );
    assert_eq!(
        app.oneshot(
            Request::builder()
                .uri("/v1/session")
                .body(Body::empty())
                .expect("request is valid"),
        )
        .await
        .expect("response")
        .status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn router_uses_injected_clock_for_session_creation_and_expiration() {
    let _guard = auth_test_lock().await;
    let pool = test_pool().await;
    reset_auth_tables(&pool).await;
    let user_id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id, email, password_hash) VALUES ($1::uuid, $2, $3)")
        .bind(user_id.to_string())
        .bind("clock@example.test")
        .bind(
            synapse_server::auth::password::hash("a secure password")
                .expect("password hashes")
                .into_bytes(),
        )
        .execute(&pool)
        .await
        .expect("user is stored");
    let clock = Arc::new(TestClock::new(UNIX_EPOCH + Duration::from_secs(10)));
    let app = synapse_server::router_with_clock(Some(pool.clone()), clock.clone());

    let response = app
        .clone()
        .oneshot(request_json(
            "/auth/login",
            r#"{"email":"clock@example.test","password":"a secure password"}"#,
        ))
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let token = response
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|cookie| cookie.to_str().ok())
        .and_then(|cookie| cookie.split(';').next())
        .and_then(|pair| pair.strip_prefix("session="))
        .and_then(synapse_server::auth::session::SessionToken::parse)
        .expect("session cookie has an opaque token");

    assert_eq!(
        synapse_server::auth::session::user_for(&pool, &token, clock.now())
            .await
            .expect("session lookup succeeds"),
        Some(user_id)
    );
    clock.advance(Duration::from_secs(8 * 60 * 60));
    let logout = Request::builder()
        .method("POST")
        .uri("/auth/logout")
        .header(header::COOKIE, format!("session={}", token.cookie_value()))
        .header(header::ORIGIN, "https://synapse.local")
        .body(Body::empty())
        .expect("logout request");
    assert_eq!(
        app.oneshot(logout).await.expect("response").status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_signup_consumes_an_invitation_only_once() {
    let _guard = auth_test_lock().await;
    let pool = test_pool().await;
    reset_auth_tables(&pool).await;
    let invite_token = "concurrently-consumed-invitation";
    sqlx::query("INSERT INTO invites (id, email, token_hash, expires_at) VALUES ($1::uuid, $2, $3, CURRENT_TIMESTAMP + INTERVAL '1 hour')")
        .bind(Uuid::new_v4().to_string())
        .bind("invited@example.test")
        .bind(Sha256::digest(invite_token.as_bytes()).to_vec())
        .execute(&pool)
        .await
        .expect("invitation is stored");
    let app = synapse_server::router(Some(pool.clone()));

    let first = tokio::spawn({
        let app = app.clone();
        async move {
            app.oneshot(request_json(
                "/auth/signup",
                r#"{"email":"first@example.test","password":"a secure password","invitation_token":"concurrently-consumed-invitation"}"#,
            ))
            .await
        }
    });
    let second = tokio::spawn(async move {
        app.oneshot(request_json(
            "/auth/signup",
            r#"{"email":"second@example.test","password":"a secure password","invitation_token":"concurrently-consumed-invitation"}"#,
        ))
        .await
    });

    let statuses = [
        first
            .await
            .expect("first task completes")
            .expect("first response")
            .status(),
        second
            .await
            .expect("second task completes")
            .expect("second response")
            .status(),
    ];
    assert_eq!(
        statuses
            .iter()
            .filter(|&&status| status == StatusCode::CREATED)
            .count(),
        1
    );
    assert_eq!(
        statuses
            .iter()
            .filter(|&&status| status == StatusCode::BAD_REQUEST)
            .count(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users")
            .fetch_one(&pool)
            .await
            .expect("user count"),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM invites WHERE accepted_at IS NOT NULL")
            .fetch_one(&pool)
            .await
            .expect("accepted invitation count"),
        1
    );
}

#[tokio::test]
async fn auth_rate_limit_rejects_excess_without_affecting_health() {
    let app = synapse_server::router(None);
    for _ in 0..5 {
        let response = app
            .clone()
            .oneshot(request_json(
                "/auth/login",
                r#"{"email":"a@example.test","password":"a secure password"}"#,
            ))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
    let limited = app
        .clone()
        .oneshot(request_json(
            "/auth/login",
            r#"{"email":"a@example.test","password":"a secure password"}"#,
        ))
        .await
        .expect("response");
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(
        limited.headers().contains_key("retry-after"),
        "the Tower governor layer communicates when retry is allowed"
    );
    let health = app
        .oneshot(
            Request::builder()
                .uri("/health/live")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(health.status(), StatusCode::OK);
}

fn request_json(uri: &str, body: &'static str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .expect("valid request")
}

async fn test_pool() -> sqlx::PgPool {
    PgPoolOptions::new()
        .max_connections(5)
        .connect("postgres://postgres@127.0.0.1:55432/synapse_test")
        .await
        .expect("test postgres is available")
}

fn configured_server(email: &str, password: &str) -> std::process::Child {
    std::process::Command::new(env!("CARGO_BIN_EXE_synapse-server"))
        .env("SYNAPSE_BIND_ADDR", "127.0.0.1:31914")
        .env(
            "SYNAPSE_DATABASE_URL",
            "postgres://postgres@127.0.0.1:55432/synapse_test",
        )
        .env("SYNAPSE_BOOTSTRAP_ADMIN_EMAIL", email)
        .env("SYNAPSE_BOOTSTRAP_ADMIN_PASSWORD", password)
        .spawn()
        .expect("configured server starts")
}

async fn wait_for_user(pool: &sqlx::PgPool, email: &str) -> (String, Vec<u8>, bool) {
    for _ in 0..20 {
        if let Ok(Some(user)) = sqlx::query_as::<_, (String, Vec<u8>, bool)>(
            "SELECT id::text, password_hash, is_admin FROM users WHERE email = $1",
        )
        .bind(email)
        .fetch_optional(pool)
        .await
        {
            return user;
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    panic!("configured bootstrap did not create its administrator");
}

async fn reset_auth_tables(pool: &sqlx::PgPool) {
    synapse_server::run_migrations(pool)
        .await
        .expect("migrations apply");
    sqlx::query("TRUNCATE sessions, invites, users CASCADE")
        .execute(pool)
        .await
        .expect("auth tables reset");
}
