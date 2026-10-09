use std::{sync::Arc, time::Duration};

use sqlx::{PgPool, postgres::PgPoolOptions};
use uuid::Uuid;

mod common;

const TEST_POSTGRES_URL: &str = "postgres://postgres@127.0.0.1:55432";

#[tokio::test]
async fn a_shared_test_database_lock_blocks_an_independent_pool_until_the_holder_releases_it() {
    let first_pool = test_pool().await;
    let second_pool = test_pool().await;
    let first_lock = reset_shared_test_database(first_pool.clone(), None).await;
    let owner_id = Uuid::new_v4();
    let vault_id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id, email, password_hash) VALUES ($1::uuid, $2, $3)")
        .bind(owner_id.to_string())
        .bind(format!("{owner_id}@example.test"))
        .bind(Vec::<u8>::new())
        .execute(&first_pool)
        .await
        .expect("test user is stored");
    let mut transaction = first_pool.begin().await.expect("transaction starts");
    sqlx::query("INSERT INTO vaults (id, owner_user_id) VALUES ($1::uuid, $2::uuid)")
        .bind(vault_id.to_string())
        .bind(owner_id.to_string())
        .execute(&mut *transaction)
        .await
        .expect("test vault is stored");
    sqlx::query(
        "INSERT INTO vault_members (vault_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')",
    )
    .bind(vault_id.to_string())
    .bind(owner_id.to_string())
    .execute(&mut *transaction)
    .await
    .expect("test owner membership is stored");
    transaction
        .commit()
        .await
        .expect("test vault setup commits");

    let (competing_lock_acquired, competing_lock_acquired_receiver) =
        tokio::sync::oneshot::channel();
    let competing_reset = reset_shared_test_database(second_pool, Some(competing_lock_acquired));
    tokio::pin!(competing_reset);
    assert!(
        tokio::select! {
            _ = &mut competing_reset => false,
            result = tokio::time::timeout(Duration::from_secs(1), competing_lock_acquired_receiver) => result.is_err(),
        },
        "an independent reset must wait for the shared database lock before migrations or truncation"
    );
    drop(first_lock);
    tokio::time::timeout(Duration::from_secs(15), &mut competing_reset)
        .await
        .expect("competing reset completes after the lock releases");
}

async fn reset_shared_test_database(
    pool: PgPool,
    lock_acquired: Option<tokio::sync::oneshot::Sender<()>>,
) -> common::TestDatabaseLock {
    let lock = common::test_database_lock().await;
    if let Some(lock_acquired) = lock_acquired {
        let _ = lock_acquired.send(());
    }
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    sqlx::query("TRUNCATE revisions, vault_members, vaults, users CASCADE")
        .execute(&pool)
        .await
        .expect("test tables reset");
    lock
}

#[tokio::test]
async fn concurrent_applications_apply_migrations_without_errors() {
    let database = TemporaryDatabase::create().await;
    let first_pool = database.pool().await;
    let second_pool = database.pool().await;
    let barrier = Arc::new(tokio::sync::Barrier::new(2));

    let migrations = tokio::time::timeout(Duration::from_secs(15), async {
        tokio::join!(
            run_migrations_after_barrier(first_pool.clone(), barrier.clone()),
            run_migrations_after_barrier(second_pool.clone(), barrier),
        )
    })
    .await;

    first_pool.close().await;
    second_pool.close().await;
    database.cleanup().await;

    let (first, second) = migrations.expect("concurrent migrations complete before the deadline");
    assert!(
        first.is_ok(),
        "the first application migrates without error"
    );
    assert!(
        second.is_ok(),
        "the second application migrates without error"
    );
}

async fn run_migrations_after_barrier(
    pool: PgPool,
    barrier: Arc<tokio::sync::Barrier>,
) -> Result<(), sqlx::Error> {
    barrier.wait().await;
    synapse_server::run_migrations(&pool).await
}

async fn test_pool() -> PgPool {
    PgPoolOptions::new()
        .max_connections(1)
        .connect(&format!("{TEST_POSTGRES_URL}/synapse_test"))
        .await
        .expect("test PostgreSQL database is available")
}

struct TemporaryDatabase {
    name: String,
    admin_pool: PgPool,
}

impl TemporaryDatabase {
    async fn create() -> Self {
        let admin_pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(&format!("{TEST_POSTGRES_URL}/postgres"))
            .await
            .expect("test PostgreSQL administration database is available");
        let name = format!("synapse_migrations_{}", Uuid::new_v4().simple());
        sqlx::query(&format!("CREATE DATABASE {name}"))
            .execute(&admin_pool)
            .await
            .expect("temporary migration database is created");
        Self { name, admin_pool }
    }

    async fn pool(&self) -> PgPool {
        PgPoolOptions::new()
            .max_connections(1)
            .connect(&format!("{TEST_POSTGRES_URL}/{}", self.name))
            .await
            .expect("temporary migration database is available")
    }

    async fn cleanup(&self) {
        sqlx::query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        )
        .bind(&self.name)
        .execute(&self.admin_pool)
        .await
        .expect("temporary migration database connections close");
        sqlx::query(&format!("DROP DATABASE {}", self.name))
            .execute(&self.admin_pool)
            .await
            .expect("temporary migration database is removed");
    }
}
