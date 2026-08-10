use axum::{
    Json,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
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

#[derive(Serialize)]
pub struct SessionResponse {
    user_id: String,
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
        let mut transaction = match pool.begin().await {
            Ok(transaction) => transaction,
            Err(_) => return signup_error(),
        };
        let invitation = sqlx::query_scalar::<_, String>("UPDATE invites SET accepted_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > CURRENT_TIMESTAMP RETURNING id::text")
            .bind(opaque_hash(&invitation_token))
            .fetch_optional(&mut *transaction)
            .await;
        let Ok(Some(_)) = invitation else {
            return signup_error();
        };
        let created =
            sqlx::query("INSERT INTO users (id, email, password_hash) VALUES ($1::uuid, $2, $3)")
                .bind(Uuid::new_v4().to_string())
                .bind(&email)
                .bind(password_hash.as_bytes())
                .execute(&mut *transaction)
                .await;
        if created.is_err() {
            return signup_error();
        }
        if transaction.commit().await.is_err() {
            return signup_error();
        }
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
    let Ok(token) = session::create(&pool, user_id, state.clock.now()).await else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let secure = if state.cookie_secure { "; Secure" } else { "" };
    let value = format!(
        "session={}; Path=/; HttpOnly{secure}; SameSite=Strict; Max-Age=28800",
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
    match session::user_for(&pool, &token, state.clock.now()).await {
        Ok(Some(_)) => {}
        Ok(None) => return StatusCode::UNAUTHORIZED,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE,
    }
    match session::revoke(&pool, &token).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}

pub async fn session_info(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SessionResponse>, StatusCode> {
    let pool = state.pool.ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let token = crate::http::vaults::session_token(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id = session::user_for(&pool, &token, state.clock.now())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    Ok(Json(SessionResponse {
        user_id: user_id.to_string(),
    }))
}
