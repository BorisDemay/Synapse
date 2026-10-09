use sqlx::{Connection, PgConnection};

const TEST_POSTGRES_URL: &str = "postgres://postgres@127.0.0.1:55432/synapse_test";
// Stable, test-only key distinct from the migration lock. A session lock remains
// held for the full integration test because this connection stays alive.
const TEST_DATABASE_LOCK_KEY: i64 = 3_155_109_930;

pub struct TestDatabaseLock {
    _connection: PgConnection,
}

pub async fn test_database_lock() -> TestDatabaseLock {
    let mut connection = PgConnection::connect(TEST_POSTGRES_URL)
        .await
        .expect("test PostgreSQL database is available");
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(TEST_DATABASE_LOCK_KEY)
        .execute(&mut connection)
        .await
        .expect("shared test database lock is acquired");
    TestDatabaseLock {
        _connection: connection,
    }
}
