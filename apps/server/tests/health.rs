use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

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
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect("postgres://postgres@127.0.0.1:55432/synapse_test")
        .await
        .unwrap();
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
