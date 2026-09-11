use std::{convert::Infallible, sync::Arc, time::Duration};

use axum::{
    body::{Body, Bytes},
    http::{Request, StatusCode, header},
};
use futures_util::stream;
use tower::ServiceExt;

#[tokio::test]
async fn saturated_sync_boundary_rejects_a_fifth_payload_before_json_decoding_and_releases_after_completion()
 {
    let barrier = Arc::new(tokio::sync::Barrier::new(5));
    let release = Arc::new(tokio::sync::Notify::new());
    let app = synapse_server::router(None);

    let mut admitted = Vec::new();
    for _ in 0..4 {
        admitted.push(tokio::spawn(
            app.clone()
                .oneshot(held_push_request(barrier.clone(), release.clone())),
        ));
    }
    barrier.wait().await;

    let saturated = tokio::time::timeout(
        Duration::from_millis(100),
        app.clone().oneshot(malformed_push_request()),
    )
    .await
    .expect("a saturated boundary rejects before reading JSON")
    .expect("router responds");
    assert_eq!(saturated.status(), StatusCode::SERVICE_UNAVAILABLE);

    for _ in 0..4 {
        release.notify_one();
    }
    for task in admitted {
        let completed = task
            .await
            .expect("held request joins")
            .expect("router responds");
        assert_eq!(completed.status(), StatusCode::BAD_REQUEST);
    }

    let after_release = app
        .oneshot(malformed_push_request())
        .await
        .expect("router responds");
    assert_eq!(after_release.status(), StatusCode::BAD_REQUEST);
}

fn held_push_request(
    barrier: Arc<tokio::sync::Barrier>,
    release: Arc<tokio::sync::Notify>,
) -> Request<Body> {
    let stream = stream::once(async move {
        barrier.wait().await;
        release.notified().await;
        Ok::<_, Infallible>(Bytes::from_static(b"{"))
    });
    Request::builder()
        .method("POST")
        .uri("/v1/vaults/00000000-0000-0000-0000-000000000000/operations")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::ORIGIN, "https://synapse.local")
        .body(Body::from_stream(stream))
        .expect("request is valid")
}

fn malformed_push_request() -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/v1/vaults/00000000-0000-0000-0000-000000000000/operations")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::ORIGIN, "https://synapse.local")
        .body(Body::from("{"))
        .expect("request is valid")
}
