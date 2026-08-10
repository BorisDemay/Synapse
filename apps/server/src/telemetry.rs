use std::sync::Once;

use axum::{
    extract::Request,
    http::{HeaderName, HeaderValue},
    middleware::Next,
    response::Response,
};
use tracing_subscriber::{EnvFilter, fmt, prelude::*};
use uuid::Uuid;

static INIT: Once = Once::new();

const REDACTED: &str = "[REDACTED]";

/// Install a JSON tracing subscriber. Safe to call multiple times; never blocks startup.
pub fn init() {
    INIT.call_once(|| {
        let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
        let _ = tracing_subscriber::registry()
            .with(filter)
            .with(fmt::layer().json().with_current_span(true).with_span_list(false))
            .try_init();
    });
}

pub fn redact_field(key: &str, value: &str) -> String {
    let normalized = key.trim().to_ascii_lowercase().replace('-', "_");
    if is_sensitive_key(&normalized) || looks_like_sensitive_value(value) {
        return REDACTED.to_owned();
    }
    value.to_owned()
}

fn is_sensitive_key(key: &str) -> bool {
    matches!(
        key,
        "password"
            | "passphrase"
            | "cookie"
            | "set_cookie"
            | "authorization"
            | "token"
            | "invitation_token"
            | "session"
            | "session_token"
            | "ciphertext"
            | "nonce"
            | "body"
            | "markdown"
            | "content"
            | "title"
            | "path"
    ) || key.contains("password")
        || key.contains("token")
        || key.contains("secret")
        || key.contains("cookie")
}

fn looks_like_sensitive_value(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.starts_with('#')
        || trimmed.contains("session=")
        || trimmed.to_ascii_lowercase().starts_with("bearer ")
}

pub async fn request_id_middleware(mut request: Request, next: Next) -> Response {
    let incoming = request
        .headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::now_v7().to_string());

    let span = tracing::info_span!(
        "http_request",
        request_id = %incoming,
        method = %request.method(),
        route = %request.uri().path(),
    );
    let _guard = span.enter();

    request.headers_mut().insert(
        HeaderName::from_static("x-request-id"),
        HeaderValue::from_str(&incoming).unwrap_or_else(|_| HeaderValue::from_static("invalid")),
    );

    let mut response = next.run(request).await;
    response.headers_mut().insert(
        HeaderName::from_static("x-request-id"),
        HeaderValue::from_str(&incoming).unwrap_or_else(|_| HeaderValue::from_static("invalid")),
    );
    crate::metrics::observe_http(response.status().as_u16());
    response
}
