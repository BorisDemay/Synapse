use axum::{
    extract::{Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::AppState;

const API_CSP: &str = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
const HSTS: &str = "max-age=31536000; includeSubDomains";

pub fn is_production() -> bool {
    matches!(
        std::env::var("SYNAPSE_ENV").as_deref(),
        Ok("production") | Ok("prod")
    )
}

pub async fn layer(State(state): State<AppState>, request: Request, next: Next) -> Response {
    if request.method() == Method::OPTIONS {
        return cors_preflight(&state, &request);
    }

    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let mut response = next.run(request).await;
    apply_security_headers(&state, response.headers_mut());
    if let Some(origin) = origin.as_deref() {
        apply_cors_if_allowed(&state, origin, response.headers_mut());
    }
    response
}

fn cors_preflight(state: &AppState, request: &Request) -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    apply_security_headers(state, response.headers_mut());
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    if let Some(origin) = origin {
        apply_cors_if_allowed(state, origin, response.headers_mut());
        if response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_some()
        {
            response.headers_mut().insert(
                header::ACCESS_CONTROL_ALLOW_METHODS,
                HeaderValue::from_static("GET, POST, PUT, OPTIONS"),
            );
            response.headers_mut().insert(
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                HeaderValue::from_static("content-type"),
            );
            response.headers_mut().insert(
                header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
                HeaderValue::from_static("true"),
            );
        }
    }
    response
}

fn apply_security_headers(state: &AppState, headers: &mut axum::http::HeaderMap) {
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(API_CSP),
    );
    if state.enable_hsts {
        headers.insert(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static(HSTS),
        );
    }
}

fn apply_cors_if_allowed(state: &AppState, origin: &str, headers: &mut axum::http::HeaderMap) {
    if origin == state.csrf_origin
        && let Ok(value) = HeaderValue::from_str(origin)
    {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
            HeaderValue::from_static("true"),
        );
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
}
