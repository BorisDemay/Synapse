use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::{
    Json,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{password, session},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignupRequest {
    email: String,
    password: String,
    invitation_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginRequest {
    email: String,
    password: String,
}

pub(crate) struct AuthRateLimit {
    window_started: Instant,
    requests: u8,
}

impl AuthRateLimit {
    pub(crate) fn new() -> Self {
        Self {
            window_started: Instant::now(),
            requests: 0,
        }
    }

    pub(crate) fn permit(&mut self) -> bool {
        if self.window_started.elapsed() >= Duration::from_secs(1) {
            self.window_started = Instant::now();
            self.requests = 0;
        }
        self.requests = self.requests.saturating_add(1);
        self.requests <= 5
    }
}

pub(crate) fn normalized_email(email: &str) -> Option<String> {
    let email = email.trim().to_lowercase();
    (email.len() <= 320 && email.contains('@') && !email.starts_with('@') && !email.ends_with('@'))
        .then_some(email)
}

fn opaque_hash(value: &str) -> Vec<u8> {
    Sha256::digest(value.as_bytes()).to_vec()
}

fn signup_error() -> StatusCode {
    StatusCode::BAD_REQUEST
}

pub async fn signup(
    State(state): State<AppState>,
    Json(request): Json<SignupRequest>,
) -> StatusCode {
    let Some(pool) = state.pool else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let Some(email) = normalized_email(&request.email) else {
        return signup_error();
    };
    let Ok(password_hash) = password::hash(&request.password) else {
        return signup_error();
    };

    if !state.allow_public_signup {
        let Some(invitation_token) = request.invitation_token else {
            return signup_error();
        };
        let invitation = sqlx::query("SELECT id::text AS id FROM invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > CURRENT_TIMESTAMP")
            .bind(opaque_hash(&invitation_token))
            .fetch_optional(&pool)
            .await;
        let Ok(Some(invitation)) = invitation else {
            return signup_error();
        };
        let invitation_id: String = invitation.get("id");
        let created =
            sqlx::query("INSERT INTO users (id, email, password_hash) VALUES ($1::uuid, $2, $3)")
                .bind(Uuid::new_v4().to_string())
                .bind(&email)
                .bind(password_hash.as_bytes())
                .execute(&pool)
                .await;
        if created.is_err() {
            return signup_error();
        }
        let _ = sqlx::query("UPDATE invites SET accepted_at = CURRENT_TIMESTAMP WHERE id = $1")
            .bind(invitation_id)
            .execute(&pool)
            .await;
    } else if sqlx::query("INSERT INTO users (id, email, password_hash) VALUES ($1::uuid, $2, $3)")
        .bind(Uuid::new_v4().to_string())
        .bind(&email)
        .bind(password_hash.as_bytes())
        .execute(&pool)
        .await
        .is_err()
    {
        return signup_error();
    }

    StatusCode::CREATED
}

pub async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.pool else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Some(email) = normalized_email(&request.email) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let user = sqlx::query("SELECT id::text AS id, password_hash FROM users WHERE email = $1")
        .bind(email)
        .fetch_optional(&pool)
        .await;
    let Ok(Some(user)) = user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(user_id) = Uuid::parse_str(&user.get::<String, _>("id")) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(hash) = String::from_utf8(user.get::<Vec<u8>, _>("password_hash")) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if password::verify(&request.password, &hash).is_err() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(token) = session::create(&pool, user_id, std::time::SystemTime::now()).await else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let value = format!(
        "session={}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800",
        token.cookie_value()
    );
    let mut response = StatusCode::NO_CONTENT.into_response();
    if let Ok(cookie) = HeaderValue::from_str(&value) {
        response.headers_mut().insert(header::SET_COOKIE, cookie);
    }
    response
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> StatusCode {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    if origin != Some(state.csrf_origin.as_str()) {
        return StatusCode::FORBIDDEN;
    }
    let token = headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies
                .split(';')
                .map(str::trim)
                .find_map(|part| part.strip_prefix("session="))
        })
        .and_then(session::SessionToken::parse);
    let (Some(pool), Some(token)) = (state.pool, token) else {
        return StatusCode::UNAUTHORIZED;
    };
    match session::revoke(&pool, &token).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}

pub async fn rate_limit(
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let permitted = state
        .rate_limit
        .lock()
        .map(|mut limit| limit.permit())
        .unwrap_or(false);
    if permitted {
        next.run(request).await
    } else {
        StatusCode::TOO_MANY_REQUESTS.into_response()
    }
}

pub(crate) fn new_rate_limit() -> Mutex<AuthRateLimit> {
    Mutex::new(AuthRateLimit::new())
}
