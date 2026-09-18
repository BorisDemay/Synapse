pub mod mail;
pub mod password;
pub mod session;

use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BootstrapError {
    InvalidCredential,
    Database,
}

impl std::fmt::Display for BootstrapError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("bootstrap administration initialization failed")
    }
}

impl std::error::Error for BootstrapError {}

pub async fn bootstrap_initial_admin(
    pool: &PgPool,
    email: &str,
    password: &str,
) -> Result<(), BootstrapError> {
    let email =
        crate::http::auth::normalized_email(email).ok_or(BootstrapError::InvalidCredential)?;
    let password_hash = password::hash(password).map_err(|_| BootstrapError::InvalidCredential)?;
    let created = sqlx::query("INSERT INTO users (id, email, password_hash, is_admin, activated_at) SELECT $1::uuid, $2, $3, TRUE, CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM users)")
        .bind(Uuid::new_v4().to_string())
        .bind(email)
        .bind(password_hash.as_bytes())
        .execute(pool)
        .await
        .map_err(|_| BootstrapError::Database)?;
    if created.rows_affected() > 1 {
        return Err(BootstrapError::Database);
    }
    Ok(())
}

pub const DEV_FIXTURE_LOGIN: &str = "test";
const DEV_FIXTURE_PASSWORD: &str = "test";

/// Seeds an already-activated local user when `enabled` is true.
/// Signup policy is unchanged; this path exists so a developer can log in
/// without mail or a 12-character password.
pub async fn seed_dev_fixture_user(pool: &PgPool, enabled: bool) -> Result<(), BootstrapError> {
    if !enabled {
        return Ok(());
    }
    let password_hash = password::hash_unconstrained(DEV_FIXTURE_PASSWORD)
        .map_err(|_| BootstrapError::InvalidCredential)?;
    sqlx::query(
        "INSERT INTO users (id, email, password_hash, is_admin, activated_at) \
         SELECT $1::uuid, $2, $3, FALSE, CURRENT_TIMESTAMP \
         ON CONFLICT (email) DO UPDATE SET \
             is_admin = FALSE, activated_at = COALESCE(users.activated_at, CURRENT_TIMESTAMP)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(DEV_FIXTURE_LOGIN)
    .bind(password_hash.as_bytes())
    .execute(pool)
    .await
    .map_err(|_| BootstrapError::Database)?;
    Ok(())
}

/// Production must never start while the development-only fixture account is
/// still present. This is deliberately a hard failure so an operator cannot
/// expose a known credential by mistake.
pub async fn ensure_no_dev_fixture(pool: &PgPool) -> Result<(), BootstrapError> {
    let present = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = lower($1))",
    )
    .bind(DEV_FIXTURE_LOGIN)
    .fetch_one(pool)
    .await
    .map_err(|_| BootstrapError::Database)?;
    if present {
        return Err(BootstrapError::InvalidCredential);
    }
    Ok(())
}
