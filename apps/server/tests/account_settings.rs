use std::sync::{Arc, OnceLock};

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use sqlx::postgres::PgPoolOptions;
use synapse_server::{RouterSettings, auth::mail::RecordingMailer, auth::session::SystemClock};
use tower::ServiceExt;
use uuid::Uuid;

async fn settings_test_lock() -> tokio::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

#[tokio::test]
async fn password_change_requires_csrf_and_the_current_password() {
    let _guard = settings_test_lock().await;
    let (app, pool, email, cookie) = signed_in_account().await;

    let forbidden = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/password",
            &cookie,
            "https://evil.example",
            r#"{"current_password":"a secure password","new_password":"replacement password"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let wrong = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/password",
            &cookie,
            "https://synapse.local",
            r#"{"current_password":"not the password","new_password":"replacement password"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);

    let short = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/password",
            &cookie,
            "https://synapse.local",
            r#"{"current_password":"a secure password","new_password":"short"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(short.status(), StatusCode::BAD_REQUEST);

    let changed = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/password",
            &cookie,
            "https://synapse.local",
            r#"{"current_password":"a secure password","new_password":"replacement password"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(changed.status(), StatusCode::NO_CONTENT);
    let body = String::from_utf8(
        changed
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    assert!(!body.contains("a secure password"));
    assert!(!body.contains("replacement password"));

    let old_login = app
        .clone()
        .oneshot(login_request(&email, "a secure password"))
        .await
        .unwrap();
    assert_eq!(old_login.status(), StatusCode::UNAUTHORIZED);

    let new_login = app
        .oneshot(login_request(&email, "replacement password"))
        .await
        .unwrap();
    assert_eq!(new_login.status(), StatusCode::NO_CONTENT);

    let remaining = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, 1);
}

#[tokio::test]
async fn password_change_revokes_other_sessions() {
    let _guard = settings_test_lock().await;
    let (app, pool, email, first_cookie) = signed_in_account().await;
    let second = app
        .clone()
        .oneshot(login_request(&email, "a secure password"))
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap(),
        2
    );

    let changed = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/password",
            &first_cookie,
            "https://synapse.local",
            r#"{"current_password":"a secure password","new_password":"replacement password"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(changed.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );

    let listed = app
        .oneshot(
            Request::builder()
                .uri("/auth/sessions")
                .header(header::COOKIE, first_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
}

#[tokio::test]
async fn session_list_and_revocation_are_cookie_bound_and_csrf_protected() {
    let _guard = settings_test_lock().await;
    let (app, _pool, email, first_cookie) = signed_in_account().await;
    let second = app
        .clone()
        .oneshot(login_request(&email, "a secure password"))
        .await
        .unwrap();
    let second_cookie = session_cookie(&second);

    let listed = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/auth/sessions")
                .header(header::COOKIE, &first_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    let payload: serde_json::Value =
        serde_json::from_slice(&listed.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(payload["email"], email);
    let sessions = payload["sessions"].as_array().expect("sessions");
    assert_eq!(sessions.len(), 2);
    assert!(sessions.iter().any(|item| item["current"] == true));
    assert_eq!(
        sessions
            .iter()
            .filter(|item| item["current"] == true)
            .count(),
        1
    );
    let dumped = payload.to_string();
    assert!(!dumped.contains("a secure password"));
    assert!(!dumped.contains("token_hash"));

    let other_id = sessions
        .iter()
        .find(|item| item["current"] == false)
        .and_then(|item| item["id"].as_str())
        .expect("other session")
        .to_owned();

    let forbidden = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/auth/sessions/{other_id}/revoke"),
            &first_cookie,
            "https://evil.example",
            "{}",
        ))
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let revoked = app
        .clone()
        .oneshot(json_request(
            "POST",
            &format!("/auth/sessions/{other_id}/revoke"),
            &first_cookie,
            "https://synapse.local",
            "{}",
        ))
        .await
        .unwrap();
    assert_eq!(revoked.status(), StatusCode::NO_CONTENT);

    let after = app
        .oneshot(
            Request::builder()
                .uri("/auth/sessions")
                .header(header::COOKIE, &second_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(after.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn account_deletion_requires_password_csrf_and_removes_owned_vaults() {
    let _guard = settings_test_lock().await;
    let (app, pool, email, cookie) = signed_in_account().await;
    let created = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/vaults")
                .header(header::COOKIE, &cookie)
                .header(header::ORIGIN, "https://synapse.local")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM vaults")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );

    let forbidden = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/account/delete",
            &cookie,
            "https://evil.example",
            r#"{"password":"a secure password"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let wrong = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/account/delete",
            &cookie,
            "https://synapse.local",
            r#"{"password":"wrong password"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);

    let deleted = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/auth/account/delete",
            &cookie,
            "https://synapse.local",
            r#"{"password":"a secure password"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let body = String::from_utf8(
        deleted
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    assert!(!body.contains("a secure password"));
    assert!(!body.contains(&email));

    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM vaults")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn storage_health_is_cookie_bound_and_reports_opaque_quota_state() {
    let _guard = settings_test_lock().await;
    let (app, _pool, _email, cookie) = signed_in_account().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health/storage")
                .header(header::COOKIE, &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let payload: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(payload["available_bytes"], 1024 * 1024 * 1024i64);
    assert_eq!(payload["quota_bytes"], 1024 * 1024 * 1024i64);
    assert_eq!(payload["used_bytes"], 0);
    assert_eq!(payload["pending_operation_count"], 0);
    assert!(payload["last_successful_backup"].is_null());

    let unauthorized = app
        .oneshot(
            Request::builder()
                .uri("/health/storage")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
}

async fn signed_in_account() -> (axum::Router, sqlx::PgPool, String, String) {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect("postgres://postgres@127.0.0.1:55432/synapse_test")
        .await
        .expect("test postgres is available");
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    sqlx::query("TRUNCATE sessions, invites, account_activations, vaults, users CASCADE")
        .execute(&pool)
        .await
        .expect("tables reset");
    let email = format!("settings-{}@example.test", Uuid::new_v4());
    let mailer = Arc::new(RecordingMailer::default());
    let app = synapse_server::router_with_settings(RouterSettings {
        allow_public_signup: true,
        blob_store: None,
        clock: Arc::new(SystemClock),
        cookie_secure: false,
        csrf_origin: "https://synapse.local".to_owned(),
        enable_hsts: false,
        mailer: mailer.clone(),
        pool: Some(pool.clone()),
        public_origin: "https://synapse.local".to_owned(),
    });
    let signup = app
        .clone()
        .oneshot(login_request_uri(
            "/auth/signup",
            &format!(r#"{{"email":"{email}","password":"a secure password"}}"#),
        ))
        .await
        .unwrap();
    assert!(
        signup.status().is_success(),
        "signup status {}",
        signup.status()
    );
    let token = mailer.activation_token().expect("activation mail");
    let activated = app
        .clone()
        .oneshot(login_request_uri(
            "/auth/activate",
            &format!(r#"{{"token":"{token}"}}"#),
        ))
        .await
        .unwrap();
    assert_eq!(activated.status(), StatusCode::NO_CONTENT);
    let login = app
        .clone()
        .oneshot(login_request(&email, "a secure password"))
        .await
        .unwrap();
    assert_eq!(login.status(), StatusCode::NO_CONTENT);
    let cookie = session_cookie(&login);
    (app, pool, email, cookie)
}

fn login_request(email: &str, password: &str) -> Request<Body> {
    login_request_uri(
        "/auth/login",
        &format!(r#"{{"email":"{email}","password":"{password}"}}"#),
    )
}

fn login_request_uri(uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap()
}

fn json_request(method: &str, uri: &str, cookie: &str, origin: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::COOKIE, cookie)
        .header(header::ORIGIN, origin)
        .header("x-forwarded-for", "198.51.100.20")
        .body(Body::from(body.to_owned()))
        .unwrap()
}

fn session_cookie(response: &axum::http::Response<Body>) -> String {
    response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .find_map(|value| {
            let value = value.to_str().ok()?;
            value
                .starts_with("session=")
                .then(|| value.split(';').next().unwrap_or(value).to_owned())
        })
        .expect("session cookie")
}
