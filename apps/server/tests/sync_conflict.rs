use std::{fs, path::PathBuf, sync::OnceLock, time::SystemTime};

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use synapse_server::blob::FilesystemBlobStore;
use tower::ServiceExt;
use uuid::Uuid;

struct TestStorage(PathBuf);

impl TestStorage {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("synapse-sync-conflict-{}", Uuid::new_v4())))
    }
}

impl Drop for TestStorage {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[tokio::test]
async fn stale_base_returns_only_opaque_base_local_and_remote_ciphertext_references() {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;

    let owner_id = create_user(&pool).await;
    let vault_id = create_vault(&pool, owner_id).await;
    let session = synapse_server::auth::session::create(&pool, owner_id, SystemTime::now())
        .await
        .expect("session is created");
    let storage = TestStorage::new();
    let app = synapse_server::router_with_blob_store(
        Some(pool.clone()),
        FilesystemBlobStore::open(&storage.0).expect("blob storage opens"),
    );
    let note_id = Uuid::new_v4();
    let base_ciphertext = vec![11_u8; 16];
    let remote_ciphertext = vec![22_u8; 16];
    let local_ciphertext = vec![33_u8; 16];
    let base_hash = hex(Sha256::digest(&base_ciphertext));
    let remote_hash = hex(Sha256::digest(&remote_ciphertext));
    let local_hash = hex(Sha256::digest(&local_ciphertext));

    let initial = app
        .clone()
        .oneshot(push_request(
            vault_id,
            &session.cookie_value(),
            uuid_v7(1),
            note_id,
            0,
            &base_ciphertext,
            &base_hash,
        ))
        .await
        .expect("initial response");
    assert_eq!(initial.status(), StatusCode::CREATED);
    let remote = app
        .clone()
        .oneshot(push_request(
            vault_id,
            &session.cookie_value(),
            uuid_v7(2),
            note_id,
            1,
            &remote_ciphertext,
            &remote_hash,
        ))
        .await
        .expect("remote response");
    assert_eq!(remote.status(), StatusCode::CREATED);

    let response = app
        .oneshot(push_request(
            vault_id,
            &session.cookie_value(),
            uuid_v7(3),
            note_id,
            1,
            &local_ciphertext,
            &local_hash,
        ))
        .await
        .expect("conflict response");

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = response
        .into_body()
        .collect()
        .await
        .expect("body is readable")
        .to_bytes();
    let conflict: serde_json::Value = serde_json::from_slice(&body).expect("conflict is JSON");
    assert_eq!(conflict["protocol_version"], 1);
    assert_eq!(conflict["operation_id"], uuid_v7(3).to_string());
    assert_eq!(conflict["vault_id"], vault_id.to_string());
    assert_eq!(conflict["note_id"], note_id.to_string());
    assert_eq!(conflict["base_revision"], 1);
    assert_eq!(conflict["remote_revision"], 2);
    assert_eq!(conflict["base_ciphertext_hash"], base_hash);
    assert_eq!(conflict["local_ciphertext_hash"], local_hash);
    assert_eq!(conflict["remote_ciphertext_hash"], remote_hash);
    assert!(conflict.get("markdown").is_none());
    assert!(conflict.get("title").is_none());

    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM operations")
            .fetch_one(&pool)
            .await
            .expect("operation count"),
        2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT current_revision FROM vaults WHERE id = $1::uuid")
            .bind(vault_id.to_string())
            .fetch_one(&pool)
            .await
            .expect("current revision"),
        2
    );
}

fn push_request(
    vault_id: Uuid,
    session: &str,
    operation_id: Uuid,
    note_id: Uuid,
    base_revision: u64,
    ciphertext: &[u8],
    ciphertext_hash: &str,
) -> Request<Body> {
    let ciphertext = ciphertext
        .iter()
        .map(u8::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let nonce = std::iter::repeat_n("17", 24).collect::<Vec<_>>().join(",");
    Request::builder()
        .method("POST")
        .uri(format!("/v1/vaults/{vault_id}/operations"))
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::COOKIE, format!("session={session}"))
        .body(Body::from(format!(
            r#"{{"protocol_version":1,"operation_id":"{operation_id}","vault_id":"{vault_id}","note_id":"{note_id}","base_revision":{base_revision},"ciphertext":[{ciphertext}],"nonce":[{nonce}],"aad_version":1,"ciphertext_hash":"{ciphertext_hash}"}}"#
        )))
        .expect("request is valid")
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
    sqlx::query("TRUNCATE operations, revisions, blobs, sync_cursors, vault_members, vaults, sessions, users CASCADE")
        .execute(pool)
        .await
        .expect("sync tables reset");
}

async fn create_user(pool: &sqlx::PgPool) -> Uuid {
    let user_id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id, email, password_hash) VALUES ($1::uuid, $2, $3)")
        .bind(user_id.to_string())
        .bind(format!("{user_id}@example.test"))
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

fn uuid_v7(sequence: u128) -> Uuid {
    Uuid::from_u128(0x018f_1234_5678_7000_8000_0000_0000_0000 + sequence)
}

fn hex(bytes: impl AsRef<[u8]>) -> String {
    bytes
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
