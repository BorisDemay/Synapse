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
use synapse_server::auth::mail::RecordingMailer;
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
async fn signup_status_reports_whether_public_signup_is_enabled() {
    async fn public_signup_flag(allow_public_signup: bool) -> serde_json::Value {
        let mut settings = test_settings(None, Arc::new(RecordingMailer::default()));
        settings.allow_public_signup = allow_public_signup;
        let response = synapse_server::router_with_settings(settings)
            .oneshot(
                Request::builder()
                    .uri("/auth/signup")
                    .body(Body::empty())
                    .expect("the request is valid"),
            )
            .await
            .expect("the router responds");
        assert_eq!(response.status(), StatusCode::OK);
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
            .expect("signup status is json")
    }

    assert_eq!(
        public_signup_flag(false).await,
        serde_json::json!({ "public_signup": false })
    );
    assert_eq!(
        public_signup_flag(true).await,
        serde_json::json!({ "public_signup": true })
    );
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

#[tokio::test]
async fn signup_rejects_an_invitation_when_the_email_does_not_match() {
    let _guard = auth_test_lock().await;
    let pool = test_pool().await;
    reset_auth_tables(&pool).await;
    let invite_token = "email-bound-invitation";
    sqlx::query("INSERT INTO invites (id, email, token_hash, expires_at) VALUES ($1::uuid, $2, $3, CURRENT_TIMESTAMP + INTERVAL '1 hour')")
        .bind(Uuid::new_v4().to_string())
        .bind("invited@example.test")
        .bind(Sha256::digest(invite_token.as_bytes()).to_vec())
        .execute(&pool)
        .await
        .expect("invitation is stored");

    let app = synapse_server::router(Some(pool.clone()));
    let mismatched = request_json(
        "/auth/signup",
        r#"{"email":"other@example.test","password":"a secure password","invitation_token":"email-bound-invitation"}"#,
    );
    assert_eq!(
        app.oneshot(mismatched).await.expect("response").status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users")
            .fetch_one(&pool)
            .await
            .expect("user count"),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM invites WHERE accepted_at IS NULL")
            .fetch_one(&pool)
            .await
            .expect("invitation remains unused"),
        1
    );
}

#[tokio::test]
async fn signup_requires_matching_email_activation_before_login() {
    let _guard = auth_test_lock().await;
    let pool = test_pool().await;
    reset_auth_tables(&pool).await;
    let invite_token = "matching-invitation";
    sqlx::query("INSERT INTO invites (id, email, token_hash, expires_at) VALUES ($1::uuid, $2, $3, CURRENT_TIMESTAMP + INTERVAL '1 hour')")
        .bind(Uuid::new_v4().to_string())
        .bind("invited@example.test")
        .bind(Sha256::digest(invite_token.as_bytes()).to_vec())
        .execute(&pool)
        .await
        .expect("invitation is stored");
    let mailer = Arc::new(RecordingMailer::default());
    let app =
        synapse_server::router_with_settings(test_settings(Some(pool.clone()), mailer.clone()));

    let signup = request_json(
        "/auth/signup",
        r#"{"email":"invited@example.test","password":"a secure password","invitation_token":"matching-invitation"}"#,
    );
    assert_eq!(
        app.clone()
            .oneshot(signup)
            .await
            .expect("response")
            .status(),
        StatusCode::CREATED
    );
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT activated_at IS NULL FROM users")
            .fetch_one(&pool)
            .await
            .expect("activation flag")
    );

    let login_before = request_json(
        "/auth/login",
        r#"{"email":"invited@example.test","password":"a secure password"}"#,
    );
    assert_eq!(
        app.clone()
            .oneshot(login_before)
            .await
            .expect("response")
            .status(),
        StatusCode::FORBIDDEN
    );

    let messages = mailer.messages();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].to, "invited@example.test");
    assert!(!messages[0].body.contains("a secure password"));
    let token = mailer
        .activation_token()
        .expect("activation token is mailed");
    assert!(
        messages[0]
            .body
            .contains(&format!("https://synapse.local/activate?token={token}"))
    );

    let invalid = request_json("/auth/activate", r#"{"token":"not-the-token"}"#);
    assert_eq!(
        app.clone()
            .oneshot(invalid)
            .await
            .expect("response")
            .status(),
        StatusCode::BAD_REQUEST
    );

    let activate = dynamic_json("/auth/activate", &format!(r#"{{"token":"{token}"}}"#));
    assert_eq!(
        app.clone()
            .oneshot(activate)
            .await
            .expect("response")
            .status(),
        StatusCode::NO_CONTENT
    );
    let reused = dynamic_json("/auth/activate", &format!(r#"{{"token":"{token}"}}"#));
    assert_eq!(
        app.clone()
            .oneshot(reused)
            .await
            .expect("response")
            .status(),
        StatusCode::BAD_REQUEST
    );

    tokio::time::sleep(Duration::from_millis(1100)).await;
    let login = request_json(
        "/auth/login",
        r#"{"email":"invited@example.test","password":"a secure password"}"#,
    );
    assert_eq!(
        app.oneshot(login).await.expect("response").status(),
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn public_signup_also_requires_activation_before_login() {
    let _guard = auth_test_lock().await;
    let pool = test_pool().await;
    reset_auth_tables(&pool).await;
    let mailer = Arc::new(RecordingMailer::default());
    let mut settings = test_settings(Some(pool.clone()), mailer.clone());
    settings.allow_public_signup = true;
    let app = synapse_server::router_with_settings(settings);

    assert_eq!(
        app.clone()
            .oneshot(request_json(
                "/auth/signup",
                r#"{"email":"public@example.test","password":"a secure password"}"#,
            ))
            .await
            .expect("response")
            .status(),
        StatusCode::CREATED
    );
    assert_eq!(
        app.clone()
            .oneshot(request_json(
                "/auth/login",
                r#"{"email":"public@example.test","password":"a secure password"}"#,
            ))
            .await
            .expect("response")
            .status(),
        StatusCode::FORBIDDEN
    );
    let token = mailer
        .activation_token()
        .expect("activation token is mailed");
    assert_eq!(
        app.clone()
            .oneshot(dynamic_json(
                "/auth/activate",
                &format!(r#"{{"token":"{token}"}}"#),
            ))
            .await
            .expect("response")
            .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.oneshot(request_json(
            "/auth/login",
            r#"{"email":"public@example.test","password":"a secure password"}"#,
        ))
        .await
        .expect("response")
        .status(),
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn expired_activation_token_cannot_unlock_the_account() {
    let _guard = auth_test_lock().await;
    let pool = test_pool().await;
    reset_auth_tables(&pool).await;
    let mailer = Arc::new(RecordingMailer::default());
    let mut settings = test_settings(Some(pool.clone()), mailer.clone());
    settings.allow_public_signup = true;
    let app = synapse_server::router_with_settings(settings);

    assert_eq!(
        app.clone()
            .oneshot(request_json(
                "/auth/signup",
                r#"{"email":"late@example.test","password":"a secure password"}"#,
            ))
            .await
            .expect("response")
            .status(),
        StatusCode::CREATED
    );
    sqlx::query(
        "UPDATE account_activations SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'",
    )
    .execute(&pool)
    .await
    .expect("token expires");
    let token = mailer
        .activation_token()
        .expect("activation token is mailed");
    assert_eq!(
        app.clone()
            .oneshot(dynamic_json(
                "/auth/activate",
                &format!(r#"{{"token":"{token}"}}"#),
            ))
            .await
            .expect("response")
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.oneshot(request_json(
            "/auth/login",
            r#"{"email":"late@example.test","password":"a secure password"}"#,
        ))
        .await
        .expect("response")
        .status(),
        StatusCode::FORBIDDEN
    );
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
async fn development_fixture_user_can_log_in_without_mail_or_password_policy() {
    let _guard = auth_test_lock().await;
    let pool = test_pool().await;
    reset_auth_tables(&pool).await;
    synapse_server::auth::seed_dev_fixture_user(&pool, false)
        .await
        .expect("disabled fixture seed is a no-op");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE email = $1")
            .bind(synapse_server::auth::DEV_FIXTURE_LOGIN)
            .fetch_one(&pool)
            .await
            .expect("count"),
        0
    );

    let stale_hash = synapse_server::auth::password::hash("an old password")
        .expect("stale fixture password is valid");
    sqlx::query(
        "INSERT INTO users (id, email, password_hash, is_admin, activated_at) \
         VALUES ($1::uuid, $2, $3, FALSE, NULL)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(synapse_server::auth::DEV_FIXTURE_LOGIN)
    .bind(stale_hash.as_bytes())
    .execute(&pool)
    .await
    .expect("stale fixture user is created");

    synapse_server::auth::seed_dev_fixture_user(&pool, true)
        .await
        .expect("fixture user is created");
    synapse_server::auth::seed_dev_fixture_user(&pool, true)
        .await
        .expect("fixture user is idempotent");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE email = $1")
            .bind(synapse_server::auth::DEV_FIXTURE_LOGIN)
            .fetch_one(&pool)
            .await
            .expect("count"),
        1
    );
    assert!(
        sqlx::query_scalar::<_, bool>(
            "SELECT activated_at IS NOT NULL AND NOT is_admin FROM users WHERE email = $1",
        )
        .bind(synapse_server::auth::DEV_FIXTURE_LOGIN)
        .fetch_one(&pool)
        .await
        .expect("fixture is an activated ordinary user")
    );
    let refreshed_hash =
        sqlx::query_scalar::<_, Vec<u8>>("SELECT password_hash FROM users WHERE email = $1")
            .bind(synapse_server::auth::DEV_FIXTURE_LOGIN)
            .fetch_one(&pool)
            .await
            .expect("fixture password hash");
    let refreshed_hash = String::from_utf8(refreshed_hash).expect("fixture hash is utf8");
    assert!(synapse_server::auth::password::verify("test", &refreshed_hash).is_ok());

    let mailer = Arc::new(RecordingMailer::default());
    let mut settings = test_settings(Some(pool.clone()), mailer.clone());
    settings.allow_public_signup = true;
    let app = synapse_server::router_with_settings(settings);

    assert_eq!(
        app.clone()
            .oneshot(request_json(
                "/auth/signup",
                r#"{"email":"test","password":"test"}"#,
            ))
            .await
            .expect("response")
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert!(mailer.messages().is_empty());

    let login = app
        .oneshot(request_json(
            "/auth/login",
            r#"{"email":"test","password":"test"}"#,
        ))
        .await
        .expect("response");
    assert_eq!(login.status(), StatusCode::NO_CONTENT);
    assert!(
        login
            .headers()
            .get(header::SET_COOKIE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|cookie| cookie.starts_with("session="))
    );
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
    sqlx::query("TRUNCATE sessions, invites, account_activations, users CASCADE")
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

    let mailer = Arc::new(RecordingMailer::default());
    let app =
        synapse_server::router_with_settings(test_settings(Some(pool.clone()), mailer.clone()));
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

    let activation_token = mailer
        .activation_token()
        .expect("activation mail contains a token");
    assert_eq!(
        app.clone()
            .oneshot(dynamic_json(
                "/auth/activate",
                &format!(r#"{{"token":"{activation_token}"}}"#),
            ))
            .await
            .expect("response")
            .status(),
        StatusCode::NO_CONTENT
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
    assert!(
        cookie.contains("Max-Age=28800"),
        "the default account session stays short: {cookie}"
    );
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
    sqlx::query("INSERT INTO users (id, email, password_hash, activated_at) VALUES ($1::uuid, $2, $3, CURRENT_TIMESTAMP)")
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

#[tokio::test]
async fn remembering_the_device_extends_the_account_session_without_a_vault_secret() {
    let _guard = auth_test_lock().await;
    let pool = test_pool().await;
    reset_auth_tables(&pool).await;
    let user_id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id, email, password_hash, activated_at) VALUES ($1::uuid, $2, $3, CURRENT_TIMESTAMP)")
        .bind(user_id.to_string())
        .bind("remember@example.test")
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

    let rejected = app
        .clone()
        .oneshot(request_json(
            "/auth/login",
            r#"{"email":"remember@example.test","password":"a secure password","vault_key":"must-never-be-accepted"}"#,
        ))
        .await
        .expect("response");
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let response = app
        .clone()
        .oneshot(request_json(
            "/auth/login",
            r#"{"email":"remember@example.test","password":"a secure password","remember_device":true}"#,
        ))
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .expect("session cookie");
    assert!(
        cookie.contains("Max-Age=2592000"),
        "remembered account sessions last thirty days: {cookie}"
    );
    assert!(!cookie.to_lowercase().contains("vault"));
    let token = cookie
        .split(';')
        .next()
        .and_then(|pair| pair.strip_prefix("session="))
        .and_then(synapse_server::auth::session::SessionToken::parse)
        .expect("session cookie has an opaque token");

    clock.advance(Duration::from_secs(8 * 60 * 60 + 1));
    assert_eq!(
        synapse_server::auth::session::user_for(&pool, &token, clock.now())
            .await
            .expect("remembered session survives the short ttl"),
        Some(user_id)
    );

    let logout = Request::builder()
        .method("POST")
        .uri("/auth/logout")
        .header(header::COOKIE, format!("session={}", token.cookie_value()))
        .header(header::ORIGIN, "https://synapse.local")
        .body(Body::empty())
        .expect("logout request");
    let logout_response = app.clone().oneshot(logout).await.expect("response");
    assert_eq!(logout_response.status(), StatusCode::NO_CONTENT);
    let expired_cookie = logout_response
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .expect("logout clears the browser cookie");
    assert!(
        expired_cookie.contains("Max-Age=0"),
        "logout must drop a remembered cookie: {expired_cookie}"
    );

    let second = app
        .clone()
        .oneshot(request_json(
            "/auth/login",
            r#"{"email":"remember@example.test","password":"a secure password","remember_device":true}"#,
        ))
        .await
        .expect("response");
    assert_eq!(second.status(), StatusCode::NO_CONTENT);
    let leftover = second
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookie| cookie.split(';').next())
        .and_then(|pair| pair.strip_prefix("session="))
        .and_then(synapse_server::auth::session::SessionToken::parse)
        .expect("second remembered cookie");
    clock.advance(Duration::from_secs(30 * 24 * 60 * 60));
    assert!(
        synapse_server::auth::session::user_for(&pool, &leftover, clock.now())
            .await
            .expect("lookup")
            .is_none()
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
            r#"{"email":"invited@example.test","password":"a secure password","invitation_token":"concurrently-consumed-invitation"}"#,
            ))
            .await
        }
    });
    let second = tokio::spawn(async move {
        app.oneshot(request_json(
            "/auth/signup",
            r#"{"email":"invited@example.test","password":"a secure password","invitation_token":"concurrently-consumed-invitation"}"#,
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

#[tokio::test]
async fn auth_rate_limit_isolated_by_forwarded_client_address() {
    let app = synapse_server::router(None);
    for _ in 0..5 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/auth/login")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-forwarded-for", "192.0.2.10")
                    .body(Body::from(
                        r#"{"email":"a@example.test","password":"a secure password"}"#,
                    ))
                    .expect("request is valid"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    let different_client = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", "192.0.2.11")
                .body(Body::from(
                    r#"{"email":"a@example.test","password":"a secure password"}"#,
                ))
                .expect("request is valid"),
        )
        .await
        .expect("response");
    assert_eq!(different_client.status(), StatusCode::SERVICE_UNAVAILABLE);
}

fn request_json(uri: &str, body: &'static str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .expect("valid request")
}

fn dynamic_json(uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_owned()))
        .expect("valid request")
}

fn test_settings(
    pool: Option<sqlx::PgPool>,
    mailer: Arc<dyn synapse_server::auth::mail::Mailer>,
) -> synapse_server::RouterSettings {
    synapse_server::RouterSettings {
        allow_public_signup: false,
        blob_store: None,
        clock: Arc::new(synapse_server::auth::session::SystemClock),
        cookie_secure: true,
        csrf_origin: "https://synapse.local".to_owned(),
        enable_hsts: false,
        mailer,
        pool,
        public_origin: "https://synapse.local".to_owned(),
    }
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
    sqlx::query("TRUNCATE sessions, invites, account_activations, users CASCADE")
        .execute(pool)
        .await
        .expect("auth tables reset");
}
