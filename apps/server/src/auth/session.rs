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

    pub(crate) fn hash(&self) -> Vec<u8> {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionLifetime {
    Standard,
    Remembered,
}

impl SessionLifetime {
    pub const STANDARD_MAX_AGE_SECS: u64 = 8 * 60 * 60;
    pub const REMEMBERED_MAX_AGE_SECS: u64 = 30 * 24 * 60 * 60;

    pub const fn max_age_secs(self) -> u64 {
        match self {
            Self::Standard => Self::STANDARD_MAX_AGE_SECS,
            Self::Remembered => Self::REMEMBERED_MAX_AGE_SECS,
        }
    }

    fn expiry_sql(self) -> &'static str {
        match self {
            Self::Standard => {
                "INSERT INTO sessions (id, user_id, token_hash, expires_at) \
                 VALUES ($1::uuid, $2::uuid, $3, to_timestamp($4) + INTERVAL '8 hours')"
            }
            Self::Remembered => {
                "INSERT INTO sessions (id, user_id, token_hash, expires_at) \
                 VALUES ($1::uuid, $2::uuid, $3, to_timestamp($4) + INTERVAL '30 days')"
            }
        }
    }
}

pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    now: SystemTime,
) -> Result<SessionToken, SessionError> {
    create_with_lifetime(pool, user_id, now, SessionLifetime::Standard).await
}

pub async fn create_with_lifetime(
    pool: &PgPool,
    user_id: Uuid,
    now: SystemTime,
    lifetime: SessionLifetime,
) -> Result<SessionToken, SessionError> {
    let token = SessionToken::generate();
    sqlx::query(lifetime.expiry_sql())
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListedSession {
    pub created_at: String,
    pub current: bool,
    pub id: String,
}

pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
    current: &SessionToken,
    now: SystemTime,
) -> Result<Vec<ListedSession>, SessionError> {
    let current_hash = current.hash();
    let rows = sqlx::query_as::<_, (String, String, Vec<u8>)>(
        "SELECT id::text, created_at::text, token_hash FROM sessions \
         WHERE user_id = $1::uuid AND expires_at > to_timestamp($2) \
         ORDER BY created_at DESC",
    )
    .bind(user_id.to_string())
    .bind(unix_seconds(now)?)
    .fetch_all(pool)
    .await
    .map_err(|_| SessionError::Database)?;
    Ok(rows
        .into_iter()
        .map(|(id, created_at, token_hash)| ListedSession {
            current: token_hash == current_hash,
            created_at,
            id,
        })
        .collect())
}

pub async fn revoke_id(
    pool: &PgPool,
    user_id: Uuid,
    session_id: Uuid,
) -> Result<bool, SessionError> {
    let result = sqlx::query("DELETE FROM sessions WHERE id = $1::uuid AND user_id = $2::uuid")
        .bind(session_id.to_string())
        .bind(user_id.to_string())
        .execute(pool)
        .await
        .map_err(|_| SessionError::Database)?;
    Ok(result.rows_affected() > 0)
}

pub async fn revoke_others(
    pool: &PgPool,
    user_id: Uuid,
    current: &SessionToken,
) -> Result<(), SessionError> {
    sqlx::query("DELETE FROM sessions WHERE user_id = $1::uuid AND token_hash <> $2")
        .bind(user_id.to_string())
        .bind(current.hash())
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|_| SessionError::Database)
}

pub async fn delete_account(pool: &PgPool, user_id: Uuid) -> Result<(), SessionError> {
    let mut transaction = pool.begin().await.map_err(|_| SessionError::Database)?;
    sqlx::query("DELETE FROM vaults WHERE owner_user_id = $1::uuid")
        .bind(user_id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(|_| SessionError::Database)?;
    sqlx::query("DELETE FROM users WHERE id = $1::uuid")
        .bind(user_id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(|_| SessionError::Database)?;
    transaction
        .commit()
        .await
        .map(|_| ())
        .map_err(|_| SessionError::Database)
}

fn unix_seconds(now: SystemTime) -> Result<f64, SessionError> {
    now.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64())
        .map_err(|_| SessionError::Database)
}
