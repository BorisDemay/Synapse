use std::{
    fmt,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::{RngCore, rngs::OsRng};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

const TOKEN_BYTES: usize = 32;

pub trait Clock: Send + Sync {
    fn now(&self) -> SystemTime;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> SystemTime {
        SystemTime::now()
    }
}

pub struct SessionToken([u8; TOKEN_BYTES]);

impl SessionToken {
    pub fn generate() -> Self {
        let mut token = [0; TOKEN_BYTES];
        OsRng.fill_bytes(&mut token);
        Self(token)
    }

    pub fn parse(value: &str) -> Option<Self> {
        let bytes = URL_SAFE_NO_PAD.decode(value).ok()?;
        Some(Self(bytes.try_into().ok()?))
    }

    pub fn cookie_value(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.0)
    }

    fn hash(&self) -> Vec<u8> {
        Sha256::digest(self.0).to_vec()
    }
}

impl fmt::Debug for SessionToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SessionToken([REDACTED])")
    }
}

#[derive(Debug)]
pub enum SessionError {
    Database,
}

impl fmt::Display for SessionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("session operation failed")
    }
}

impl std::error::Error for SessionError {}

pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    now: SystemTime,
) -> Result<SessionToken, SessionError> {
    let token = SessionToken::generate();
    sqlx::query("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1::uuid, $2::uuid, $3, to_timestamp($4) + INTERVAL '8 hours')")
        .bind(Uuid::new_v4().to_string())
        .bind(user_id.to_string())
        .bind(token.hash())
        .bind(unix_seconds(now)?)
        .execute(pool)
        .await
        .map_err(|_| SessionError::Database)?;
    Ok(token)
}

pub async fn user_for(
    pool: &PgPool,
    token: &SessionToken,
    now: SystemTime,
) -> Result<Option<Uuid>, SessionError> {
    let user_id: Option<String> = sqlx::query_scalar("SELECT user_id::text FROM sessions WHERE token_hash = $1 AND expires_at > to_timestamp($2)")
        .bind(token.hash())
        .bind(unix_seconds(now)?)
        .fetch_optional(pool)
        .await
        .map_err(|_| SessionError::Database)?;
    user_id
        .map(|value| Uuid::parse_str(&value).map_err(|_| SessionError::Database))
        .transpose()
}

pub async fn revoke(pool: &PgPool, token: &SessionToken) -> Result<(), SessionError> {
    sqlx::query("DELETE FROM sessions WHERE token_hash = $1")
        .bind(token.hash())
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|_| SessionError::Database)
}

fn unix_seconds(now: SystemTime) -> Result<f64, SessionError> {
    now.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64())
        .map_err(|_| SessionError::Database)
}
