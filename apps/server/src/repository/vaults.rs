use std::fmt;

use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug)]
pub enum VaultRepositoryError {
    Database,
}

impl fmt::Display for VaultRepositoryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("vault repository operation failed")
    }
}

impl std::error::Error for VaultRepositoryError {}

pub async fn create_for_owner(
    pool: &PgPool,
    owner_user_id: Uuid,
) -> Result<Uuid, VaultRepositoryError> {
    let vault_id = Uuid::new_v4();
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| VaultRepositoryError::Database)?;

    sqlx::query("INSERT INTO vaults (id, owner_user_id) VALUES ($1::uuid, $2::uuid)")
        .bind(vault_id.to_string())
        .bind(owner_user_id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(|_| VaultRepositoryError::Database)?;
    sqlx::query(
        "INSERT INTO vault_members (vault_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')",
    )
    .bind(vault_id.to_string())
    .bind(owner_user_id.to_string())
    .execute(&mut *transaction)
    .await
    .map_err(|_| VaultRepositoryError::Database)?;

    transaction
        .commit()
        .await
        .map_err(|_| VaultRepositoryError::Database)?;
    Ok(vault_id)
}

pub async fn find_owned(
    pool: &PgPool,
    vault_id: Uuid,
    user_id: Uuid,
) -> Result<Option<Uuid>, VaultRepositoryError> {
    sqlx::query_scalar::<_, String>(
        "SELECT id::text FROM vaults WHERE id = $1::uuid AND owner_user_id = $2::uuid",
    )
    .bind(vault_id.to_string())
    .bind(user_id.to_string())
    .fetch_optional(pool)
    .await
    .map_err(|_| VaultRepositoryError::Database)?
    .map(|id| Uuid::parse_str(&id).map_err(|_| VaultRepositoryError::Database))
    .transpose()
}
