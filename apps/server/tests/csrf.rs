use std::sync::Arc;

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use sqlx::postgres::PgPoolOptions;
use synapse_server::{RouterSettings, auth::session::SystemClock};
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn cookie_authenticated_mutations_require_the_allowlisted_origin() {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect("postgres://postgres@127.0.0.1:55432/synapse_test")
        .await
        .unwrap();
    reset_schema(&pool).await;
    synapse_server::run_migrations(&pool).await.unwrap();

    let email = format!("csrf-{}@example.test", Uuid::new_v4());
    let app = synapse_server::router_with_settings(RouterSettings {
        allow_public_signup: true,
        blob_store: None,
        clock: Arc::new(SystemClock),
        cookie_secure: false,
        csrf_origin: "https://synapse.local".to_owned(),
        enable_hsts: false,
        pool: Some(pool),
    });
    let signup = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/signup")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"email":"{email}","password":"a secure password"}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        signup.status().is_success(),
        "signup status {}",
        signup.status()
    );

    let login = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"email":"{email}","password":"a secure password"}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(login.status(), StatusCode::NO_CONTENT);
    let cookie = login
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .find_map(|value| {
            let value = value.to_str().ok()?;
            value
                .starts_with("session=")
                .then(|| value.split(';').next().unwrap_or(value).to_owned())
        })
        .expect("session cookie");

    let forbidden = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/logout")
                .header(header::COOKIE, &cookie)
                .header(header::ORIGIN, "https://evil.example")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let allowed = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/logout")
                .header(header::COOKIE, &cookie)
                .header(header::ORIGIN, "https://synapse.local")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(allowed.status(), StatusCode::NO_CONTENT);
}

async fn reset_schema(pool: &sqlx::PgPool) {
    sqlx::query("DROP SCHEMA public CASCADE")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("CREATE SCHEMA public")
        .execute(pool)
        .await
        .unwrap();
}
