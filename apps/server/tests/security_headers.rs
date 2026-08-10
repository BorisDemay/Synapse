use std::sync::Arc;

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use synapse_server::{RouterSettings, auth::session::SystemClock};
use tower::ServiceExt;

fn test_router(csrf_origin: &str, enable_hsts: bool) -> axum::Router {
    synapse_server::router_with_settings(RouterSettings {
        allow_public_signup: false,
        blob_store: None,
        clock: Arc::new(SystemClock),
        cookie_secure: true,
        csrf_origin: csrf_origin.to_owned(),
        enable_hsts,
        pool: None,
    })
}

#[tokio::test]
async fn responses_include_baseline_security_headers() {
    let response = test_router("https://synapse.local", false)
        .oneshot(
            Request::builder()
                .uri("/health/live")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let headers = response.headers();
    assert_eq!(
        headers.get(header::X_CONTENT_TYPE_OPTIONS).unwrap(),
        "nosniff"
    );
    assert_eq!(headers.get(header::REFERRER_POLICY).unwrap(), "no-referrer");
    assert_eq!(
        headers.get(header::CONTENT_SECURITY_POLICY).unwrap(),
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    );
    assert!(headers.get(header::STRICT_TRANSPORT_SECURITY).is_none());
}

#[tokio::test]
async fn production_responses_include_hsts() {
    let response = test_router("https://synapse.local", true)
        .oneshot(
            Request::builder()
                .uri("/health/live")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        response
            .headers()
            .get(header::STRICT_TRANSPORT_SECURITY)
            .unwrap(),
        "max-age=31536000; includeSubDomains"
    );
}

#[tokio::test]
async fn cors_allowlist_echoes_only_the_configured_origin() {
    let allowed = test_router("https://vault.example", false)
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/v1/session")
                .header(header::ORIGIN, "https://vault.example")
                .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(allowed.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        allowed
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .unwrap(),
        "https://vault.example"
    );

    let denied = test_router("https://vault.example", false)
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/v1/session")
                .header(header::ORIGIN, "https://evil.example")
                .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        denied
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none()
    );
}
