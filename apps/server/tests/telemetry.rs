use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

#[test]
fn redacts_passwords_cookies_tokens_and_markdown_from_log_fields() {
    let password = synapse_server::telemetry::redact_field("password", "correct horse battery");
    let cookie =
        synapse_server::telemetry::redact_field("cookie", "session=opaque-token-value; Path=/");
    let token = synapse_server::telemetry::redact_field("invitation_token", "invite-secret");
    let authorization =
        synapse_server::telemetry::redact_field("authorization", "Bearer top-secret");
    let markdown = synapse_server::telemetry::redact_field("body", "# Private note\n\nsecret");

    assert_eq!(password, "[REDACTED]");
    assert_eq!(cookie, "[REDACTED]");
    assert_eq!(token, "[REDACTED]");
    assert_eq!(authorization, "[REDACTED]");
    assert_eq!(markdown, "[REDACTED]");
    assert!(!password.contains("horse"));
    assert!(!cookie.contains("opaque-token-value"));
    assert!(!markdown.contains("Private note"));
}

#[test]
fn metric_names_avoid_high_cardinality_identity_labels() {
    let names = synapse_server::metrics::metric_names();
    assert!(names.contains(&"synapse_http_requests_total"));
    assert!(names.contains(&"synapse_sync_push_total"));
    assert!(names.contains(&"synapse_sync_pull_total"));
    assert!(names.contains(&"synapse_sync_conflicts_total"));
    assert!(names.contains(&"synapse_ws_connections"));
    for name in names {
        assert!(!name.contains("user"));
        assert!(!name.contains("vault"));
        assert!(!name.contains("email"));
    }
}

#[tokio::test]
async fn responses_include_a_request_id_without_payload_echo() {
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
    let request_id = response
        .headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .expect("request id header")
        .to_owned();
    assert!(!request_id.is_empty());
    let body = http_body_util::BodyExt::collect(response.into_body())
        .await
        .unwrap()
        .to_bytes();
    assert!(!String::from_utf8_lossy(&body).contains(&request_id));
}

#[tokio::test]
async fn metrics_endpoint_exposes_prometheus_text_without_user_labels() {
    let response = synapse_server::router(None)
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = String::from_utf8(
        http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    assert!(body.contains("synapse_http_requests_total"));
    assert!(!body.contains("user_id="));
    assert!(!body.contains("vault_id="));
    assert!(!body.contains("# Private"));
}
