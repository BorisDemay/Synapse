use std::time::{Duration, SystemTime};

use sqlx::postgres::PgPoolOptions;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use uuid::Uuid;

mod common;

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
    assert_status(
        websocket_handshake_without_origin(address, vault_id, &owner_session.cookie_value()).await,
        101,
    );
    server.abort();
}

#[tokio::test]
async fn websocket_handshake_rejects_a_foreign_origin() {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;

    let owner_id = create_user(&pool, "origin-owner@example.test").await;
    let vault_id = create_vault(&pool, owner_id).await;
    let session = synapse_server::auth::session::create(&pool, owner_id, SystemTime::now())
        .await
        .expect("owner session is created");
    let (address, server) = start_server(synapse_server::router(Some(pool))).await;

    assert_status(
        websocket_handshake_with_origin(
            address,
            vault_id,
            Some(&session.cookie_value()),
            "https://foreign.example",
        )
        .await,
        403,
    );
    server.abort();
}

#[tokio::test]
async fn websocket_sends_close_when_its_session_logs_out() {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;

    let owner_id = create_user(&pool, "owner@example.test").await;
    let vault_id = create_vault(&pool, owner_id).await;
    let session = synapse_server::auth::session::create(&pool, owner_id, SystemTime::now())
        .await
        .expect("owner session is created");
    let (address, server) = start_server(synapse_server::router(Some(pool))).await;
    let mut socket = websocket_connection(address, vault_id, &session.cookie_value()).await;

    assert_status(logout(address, &session.cookie_value()).await, 204);
    let mut frame = [0; 2];
    let size = tokio::time::timeout(Duration::from_secs(2), socket.read(&mut frame))
        .await
        .expect("revoked websocket closes promptly")
        .expect("close frame is readable");
    assert!(size >= 1, "close frame is not empty");
    assert_eq!(frame[0], 0x88, "revoked websocket sends a Close frame");
    server.abort();
}

#[tokio::test]
async fn websocket_heartbeat_closes_when_session_is_removed_without_a_wakeup() {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;

    let owner_id = create_user(&pool, "inactive-heartbeat-owner@example.test").await;
    let vault_id = create_vault(&pool, owner_id).await;
    let session = synapse_server::auth::session::create(&pool, owner_id, SystemTime::now())
        .await
        .expect("owner session is created");
    let (address, server) = start_heartbeat_server(pool.clone()).await;
    let mut socket = websocket_connection(address, vault_id, &session.cookie_value()).await;

    sqlx::query("DELETE FROM sessions WHERE user_id = $1::uuid")
        .bind(owner_id.to_string())
        .execute(&pool)
        .await
        .expect("session is removed without a revocation notification");
    assert_eq!(
        read_server_frame_kind(&mut socket).await,
        0x88,
        "heartbeat closes without emitting a ping after invalidation"
    );
    server.abort();
}

#[tokio::test]
async fn websocket_heartbeat_closes_when_membership_is_removed_without_a_wakeup() {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;

    let owner_id = create_user(&pool, "membership-owner@example.test").await;
    let member_id = create_user(&pool, "membership-member@example.test").await;
    let vault_id = create_vault(&pool, owner_id).await;
    add_member(&pool, vault_id, member_id).await;
    let session = synapse_server::auth::session::create(&pool, member_id, SystemTime::now())
        .await
        .expect("member session is created");
    let (address, server) = start_heartbeat_server(pool.clone()).await;
    let mut socket = websocket_connection(address, vault_id, &session.cookie_value()).await;

    sqlx::query("DELETE FROM vault_members WHERE vault_id = $1::uuid AND user_id = $2::uuid")
        .bind(vault_id.to_string())
        .bind(member_id.to_string())
        .execute(&pool)
        .await
        .expect("membership is removed without a notification");
    assert_eq!(
        read_server_frame_kind(&mut socket).await,
        0x88,
        "heartbeat closes without emitting a ping after membership removal"
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

async fn start_heartbeat_server(
    pool: sqlx::PgPool,
) -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
    start_server(synapse_server::router_with_websocket_heartbeat(
        Some(pool),
        Duration::from_millis(10),
    ))
    .await
}

async fn websocket_handshake(
    address: std::net::SocketAddr,
    vault_id: Uuid,
    session: Option<&str>,
) -> String {
    websocket_handshake_with_origin(address, vault_id, session, "https://synapse.local").await
}

async fn websocket_handshake_with_origin(
    address: std::net::SocketAddr,
    vault_id: Uuid,
    session: Option<&str>,
    origin: &str,
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
                "GET /v1/vaults/{vault_id}/ws HTTP/1.1\r\nHost: {address}\r\nOrigin: {origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n{cookie}\r\n"
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

async fn websocket_handshake_without_origin(
    address: std::net::SocketAddr,
    vault_id: Uuid,
    session: &str,
) -> String {
    let mut stream = TcpStream::connect(address)
        .await
        .expect("server accepts native connection");
    stream
        .write_all(
            format!(
                "GET /v1/vaults/{vault_id}/ws HTTP/1.1\r\nHost: {address}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nCookie: session={session}\r\n\r\n"
            )
            .as_bytes(),
        )
        .await
        .expect("native handshake is sent");
    let mut response = vec![0; 1024];
    let size = stream
        .read(&mut response)
        .await
        .expect("native response is readable");
    String::from_utf8(response[..size].to_vec()).expect("native response is UTF-8")
}

async fn websocket_connection(
    address: std::net::SocketAddr,
    vault_id: Uuid,
    session: &str,
) -> TcpStream {
    let mut stream = TcpStream::connect(address)
        .await
        .expect("server accepts websocket connection");
    stream
        .write_all(
            format!(
                "GET /v1/vaults/{vault_id}/ws HTTP/1.1\r\nHost: {address}\r\nOrigin: https://synapse.local\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nCookie: session={session}\r\n\r\n"
            )
            .as_bytes(),
        )
        .await
        .expect("websocket handshake is sent");
    let mut response = vec![0; 1024];
    let size = stream
        .read(&mut response)
        .await
        .expect("websocket response is readable");
    assert_status(
        String::from_utf8(response[..size].to_vec()).expect("websocket response is UTF-8"),
        101,
    );
    stream
}

async fn logout(address: std::net::SocketAddr, session: &str) -> String {
    let mut stream = TcpStream::connect(address)
        .await
        .expect("server accepts logout connection");
    stream
        .write_all(
            format!(
                "POST /auth/logout HTTP/1.1\r\nHost: {address}\r\nOrigin: https://synapse.local\r\nCookie: session={session}\r\nContent-Length: 0\r\n\r\n"
            )
            .as_bytes(),
        )
        .await
        .expect("logout is sent");
    let mut response = vec![0; 1024];
    let size = stream
        .read(&mut response)
        .await
        .expect("logout response is readable");
    String::from_utf8(response[..size].to_vec()).expect("logout response is UTF-8")
}

async fn read_server_frame_kind(socket: &mut TcpStream) -> u8 {
    let mut frame = [0; 2];
    tokio::time::timeout(Duration::from_millis(500), socket.read_exact(&mut frame))
        .await
        .expect("server frame arrives promptly")
        .expect("server frame is readable");
    frame[0]
}

async fn sync_test_lock() -> common::TestDatabaseLock {
    common::test_database_lock().await
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

async fn add_member(pool: &sqlx::PgPool, vault_id: Uuid, user_id: Uuid) {
    sqlx::query(
        "INSERT INTO vault_members (vault_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'reader')",
    )
    .bind(vault_id.to_string())
    .bind(user_id.to_string())
    .execute(pool)
    .await
    .expect("member is stored");
}
