use std::time::{Duration, UNIX_EPOCH};

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

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
async fn signup_login_session_revocation_expiration_and_csrf_are_enforced() {
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
    assert_eq!(
        app.clone()
            .oneshot(request_json(
                "/auth/login",
                r#"{"email":"a@example.test","password":"a secure password"}"#
            ))
            .await
            .expect("response")
            .status(),
        StatusCode::TOO_MANY_REQUESTS
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
