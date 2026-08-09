use std::{sync::OnceLock, time::SystemTime};

use sqlx::postgres::PgPoolOptions;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use uuid::Uuid;

#[tokio::test]
async fn websocket_handshake_requires_a_valid_session_and_hides_other_vaults() {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;

    let owner_id = create_user(&pool, "owner@example.test").await;
    let stranger_id = create_user(&pool, "stranger@example.test").await;
    let vault_id = create_vault(&pool, owner_id).await;
    let owner_session = synapse_server::auth::session::create(&pool, owner_id, SystemTime::now())
        .await
        .expect("owner session is created");
    let stranger_session =
        synapse_server::auth::session::create(&pool, stranger_id, SystemTime::now())
            .await
            .expect("stranger session is created");
    let (address, server) = start_server(synapse_server::router(Some(pool))).await;

    assert_status(websocket_handshake(address, vault_id, None).await, 401);
    assert_status(
        websocket_handshake(address, vault_id, Some(&stranger_session.cookie_value())).await,
        404,
    );
    assert_status(
        websocket_handshake(address, vault_id, Some(&owner_session.cookie_value())).await,
        101,
    );
    server.abort();
}

fn assert_status(response: String, status: u16) {
    assert!(
        response.starts_with(&format!("HTTP/1.1 {status}")),
        "expected HTTP {status}, got {response}"
    );
}

async fn start_server(app: axum::Router) -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener binds");
    let address = listener.local_addr().expect("listener has an address");
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.expect("server runs");
    });
    (address, server)
}

async fn websocket_handshake(
    address: std::net::SocketAddr,
    vault_id: Uuid,
    session: Option<&str>,
) -> String {
    let mut stream = TcpStream::connect(address)
        .await
        .expect("server accepts connection");
    let cookie = session
        .map(|value| format!("Cookie: session={value}\r\n"))
        .unwrap_or_default();
    stream
        .write_all(
            format!(
                "GET /v1/vaults/{vault_id}/ws HTTP/1.1\r\nHost: {address}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n{cookie}\r\n"
            )
            .as_bytes(),
        )
        .await
        .expect("handshake is sent");
    let mut response = vec![0; 1024];
    let size = stream
        .read(&mut response)
        .await
        .expect("response is readable");
    String::from_utf8(response[..size].to_vec()).expect("response is UTF-8")
}

async fn sync_test_lock() -> tokio::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

async fn test_pool() -> sqlx::PgPool {
    PgPoolOptions::new()
        .max_connections(5)
        .connect("postgres://postgres@127.0.0.1:55432/synapse_test")
        .await
        .expect("test postgres is available")
}

async fn reset_sync_tables(pool: &sqlx::PgPool) {
    sqlx::query(
        "TRUNCATE operations, revisions, blobs, vault_members, vaults, sessions, users CASCADE",
    )
    .execute(pool)
    .await
    .expect("sync tables reset");
}

async fn create_user(pool: &sqlx::PgPool, email: &str) -> Uuid {
    let user_id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id, email, password_hash) VALUES ($1::uuid, $2, $3)")
        .bind(user_id.to_string())
        .bind(email)
        .bind(b"not-used-by-this-test".as_slice())
        .execute(pool)
        .await
        .expect("user is stored");
    user_id
}

async fn create_vault(pool: &sqlx::PgPool, owner_id: Uuid) -> Uuid {
    let vault_id = Uuid::new_v4();
    let mut transaction = pool.begin().await.expect("transaction starts");
    sqlx::query("INSERT INTO vaults (id, owner_user_id) VALUES ($1::uuid, $2::uuid)")
        .bind(vault_id.to_string())
        .bind(owner_id.to_string())
        .execute(&mut *transaction)
        .await
        .expect("vault is stored");
    sqlx::query(
        "INSERT INTO vault_members (vault_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')",
    )
    .bind(vault_id.to_string())
    .bind(owner_id.to_string())
    .execute(&mut *transaction)
    .await
    .expect("owner membership is stored");
    transaction.commit().await.expect("vault setup commits");
    vault_id
}
