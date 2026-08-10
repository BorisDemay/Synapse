use std::sync::OnceLock;

use axum::response::IntoResponse;
use prometheus::{
    Encoder, IntCounter, IntCounterVec, IntGauge, Opts, Registry, TextEncoder, opts,
};

struct Metrics {
    conflicts: IntCounter,
    http_requests: IntCounterVec,
    pull: IntCounter,
    push: IntCounterVec,
    registry: Registry,
    ws_connections: IntGauge,
}

fn metrics() -> &'static Metrics {
    static METRICS: OnceLock<Metrics> = OnceLock::new();
    METRICS.get_or_init(|| {
        let registry = Registry::new_custom(Some("synapse".to_owned()), None)
            .expect("prometheus registry");
        let http_requests = IntCounterVec::new(
            Opts::new(
                "http_requests_total",
                "HTTP responses by coarse status class",
            ),
            &["status_class"],
        )
        .expect("http counter");
        let push = IntCounterVec::new(
            Opts::new("sync_push_total", "Encrypted push outcomes"),
            &["result"],
        )
        .expect("push counter");
        let pull = IntCounter::with_opts(Opts::new(
            "sync_pull_total",
            "Encrypted pull responses",
        ))
        .expect("pull counter");
        let conflicts = IntCounter::with_opts(Opts::new(
            "sync_conflicts_total",
            "Stale-base conflict responses",
        ))
        .expect("conflict counter");
        let ws_connections = IntGauge::with_opts(opts!(
            "ws_connections",
            "Active authenticated WebSocket connections"
        ))
        .expect("ws gauge");

        registry
            .register(Box::new(http_requests.clone()))
            .expect("register http");
        registry
            .register(Box::new(push.clone()))
            .expect("register push");
        registry
            .register(Box::new(pull.clone()))
            .expect("register pull");
        registry
            .register(Box::new(conflicts.clone()))
            .expect("register conflicts");
        registry
            .register(Box::new(ws_connections.clone()))
            .expect("register ws");

        for class in ["1xx", "2xx", "3xx", "4xx", "5xx"] {
            http_requests.with_label_values(&[class]);
        }
        for result in ["accepted", "conflict", "error"] {
            push.with_label_values(&[result]);
        }
        let _ = pull.get();
        let _ = conflicts.get();
        let _ = ws_connections.get();

        Metrics {
            conflicts,
            http_requests,
            pull,
            push,
            registry,
            ws_connections,
        }
    })
}

pub fn metric_names() -> Vec<&'static str> {
    vec![
        "synapse_http_requests_total",
        "synapse_sync_push_total",
        "synapse_sync_pull_total",
        "synapse_sync_conflicts_total",
        "synapse_ws_connections",
    ]
}

pub fn observe_http(status: u16) {
    let class = match status {
        100..=199 => "1xx",
        200..=299 => "2xx",
        300..=399 => "3xx",
        400..=499 => "4xx",
        _ => "5xx",
    };
    metrics()
        .http_requests
        .with_label_values(&[class])
        .inc();
}

pub fn observe_push_accepted() {
    metrics().push.with_label_values(&["accepted"]).inc();
}

pub fn observe_push_conflict() {
    metrics().push.with_label_values(&["conflict"]).inc();
    metrics().conflicts.inc();
}

pub fn observe_push_error() {
    metrics().push.with_label_values(&["error"]).inc();
}

pub fn observe_pull() {
    metrics().pull.inc();
}

pub fn ws_connected() {
    metrics().ws_connections.inc();
}

pub fn ws_disconnected() {
    metrics().ws_connections.dec();
}

pub async fn render() -> impl IntoResponse {
    let encoder = TextEncoder::new();
    let families = metrics().registry.gather();
    let mut buffer = Vec::new();
    encoder
        .encode(&families, &mut buffer)
        .expect("prometheus encode");
    (
        [(
            axum::http::header::CONTENT_TYPE,
            encoder.format_type().to_owned(),
        )],
        buffer,
    )
}
