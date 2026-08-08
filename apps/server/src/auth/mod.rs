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
    let created = sqlx::query("INSERT INTO users (id, email, password_hash) SELECT $1::uuid, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM users)")
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
