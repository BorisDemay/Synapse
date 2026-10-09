use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

mod common;

#[tokio::test]
async fn live_health_returns_ok_without_a_database() {
    let response = synapse_server::router(None)
        .oneshot(
            Request::builder()
                .uri("/health/live")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .as_ref(),
        br#"{"status":"ok"}"#
    );
}

#[tokio::test]
async fn version_health_exposes_only_release_identity() {
    let response = synapse_server::router(None)
        .oneshot(
            Request::builder()
                .uri("/health/version")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(body["protocol_version"], "v1");
    assert!(
        body["commit_sha"]
            .as_str()
            .is_some_and(|sha| !sha.is_empty())
    );
    assert_eq!(body.as_object().unwrap().len(), 3);
}

#[tokio::test]
async fn ready_health_is_unavailable_without_a_database() {
    let response = synapse_server::router(None)
        .oneshot(
            Request::builder()
                .uri("/health/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn ready_health_returns_ok_after_migrations() {
    let _database_lock = common::test_database_lock().await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect("postgres://postgres@127.0.0.1:55432/synapse_test")
        .await
        .unwrap();
    // Wipes synapse_test only. Interactive local accounts must use synapse_dev.
    sqlx::query("DROP SCHEMA public CASCADE")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("CREATE SCHEMA public")
        .execute(&pool)
        .await
        .unwrap();
    synapse_server::run_migrations(&pool).await.unwrap();
    synapse_server::run_migrations(&pool).await.unwrap();

    let response = synapse_server::router(Some(pool))
        .oneshot(
            Request::builder()
                .uri("/health/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
