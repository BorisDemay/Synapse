use std::{fs, path::PathBuf, time::SystemTime};

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

mod common;

struct TestStorage {
    path: PathBuf,
}

impl TestStorage {
    fn new() -> Self {
        Self {
            path: std::env::temp_dir().join(format!("synapse-sync-push-{}", Uuid::new_v4())),
        }
    }
}

impl Drop for TestStorage {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[tokio::test]
async fn authenticated_owner_pushes_an_opaque_operation_at_the_current_revision() {
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
        .expect("session is created");
    let storage = TestStorage::new();
    let app = synapse_server::router_with_blob_store(
        Some(pool.clone()),
        FilesystemBlobStore::open(&storage.path).expect("blob storage opens"),
    );
    let operation_id = uuid_v7(1);
    let note_id = Uuid::new_v4();
    let ciphertext = vec![214_u8; 16];
    let ciphertext_hash = hex(Sha256::digest(&ciphertext));

    let response = app
        .oneshot(push_request(
            vault_id,
            &session.cookie_value(),
            operation_id,
            note_id,
            &ciphertext,
            &ciphertext_hash,
        ))
        .await
        .expect("router responds");

    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(
        response
            .into_body()
            .collect()
            .await
            .expect("response body is readable")
            .to_bytes(),
        format!(r#"{{"operation_id":"{operation_id}","revision":1}}"#)
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT current_revision FROM vaults WHERE id = $1::uuid")
            .bind(vault_id.to_string())
            .fetch_one(&pool)
            .await
            .expect("current revision is readable"),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM revisions WHERE vault_id = $1::uuid")
            .bind(vault_id.to_string())
            .fetch_one(&pool)
            .await
            .expect("revision count is readable"),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, Vec<u8>>("SELECT ciphertext FROM operations WHERE id = $1::uuid",)
            .bind(operation_id.to_string())
            .fetch_one(&pool)
            .await
            .expect("operation ciphertext is readable"),
        ciphertext
    );
}

#[tokio::test]
async fn replaying_an_operation_returns_its_durable_ack_without_a_second_revision() {
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
        .expect("session is created");
    let storage = TestStorage::new();
    let app = synapse_server::router_with_blob_store(
        Some(pool.clone()),
        FilesystemBlobStore::open(&storage.path).expect("blob storage opens"),
    );
    let operation_id = uuid_v7(2);
    let note_id = Uuid::new_v4();
    let ciphertext = vec![91_u8; 16];
    let ciphertext_hash = hex(Sha256::digest(&ciphertext));
    let first = app
        .clone()
        .oneshot(push_request(
            vault_id,
            &session.cookie_value(),
            operation_id,
            note_id,
            &ciphertext,
            &ciphertext_hash,
        ))
        .await
        .expect("first response");
    let first_body = first
        .into_body()
        .collect()
        .await
        .expect("first body")
        .to_bytes();
    let replay = app
        .oneshot(push_request(
            vault_id,
            &session.cookie_value(),
            operation_id,
            note_id,
            &ciphertext,
            &ciphertext_hash,
        ))
        .await
        .expect("replay response");

    assert_eq!(replay.status(), StatusCode::CREATED);
    assert_eq!(
        replay
            .into_body()
            .collect()
            .await
            .expect("replay body")
            .to_bytes(),
        first_body
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM revisions WHERE vault_id = $1::uuid")
            .bind(vault_id.to_string())
            .fetch_one(&pool)
            .await
            .expect("revision count"),
        1
    );
}

#[tokio::test]
async fn reusing_an_operation_id_with_a_changed_payload_is_rejected() {
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
        .expect("session is created");
    let storage = TestStorage::new();
    let app = synapse_server::router_with_blob_store(
        Some(pool.clone()),
        FilesystemBlobStore::open(&storage.path).expect("blob storage opens"),
    );
    let operation_id = uuid_v7(8);
    let note_id = Uuid::new_v4();
    let original = vec![101_u8; 16];
    let original_hash = hex(Sha256::digest(&original));
    let first = app
        .clone()
        .oneshot(push_request(
            vault_id,
            &session.cookie_value(),
            operation_id,
            note_id,
            &original,
            &original_hash,
        ))
        .await
        .expect("first response");
    assert_eq!(first.status(), StatusCode::CREATED);

    let changed = vec![102_u8; 16];
    let changed_response = app
        .oneshot(push_request(
            vault_id,
            &session.cookie_value(),
            operation_id,
            note_id,
            &changed,
            &hex(Sha256::digest(&changed)),
        ))
        .await
        .expect("changed replay response");
    assert_eq!(changed_response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        sqlx::query_scalar::<_, Vec<u8>>("SELECT ciphertext FROM operations WHERE id = $1::uuid")
            .bind(operation_id.to_string())
            .fetch_one(&pool)
            .await
            .expect("stored ciphertext"),
        original
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM revisions WHERE vault_id = $1::uuid")
            .bind(vault_id.to_string())
            .fetch_one(&pool)
            .await
            .expect("revision count"),
        1
    );
}

#[tokio::test]
async fn failed_blob_write_leaves_no_database_revision_or_operation() {
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
        .expect("session is created");
    let app = synapse_server::router_with_blob_store(Some(pool.clone()), FailingBlobStore);
    let ciphertext = vec![22_u8; 16];

    let response = app
        .oneshot(push_request(
            vault_id,
            &session.cookie_value(),
            uuid_v7(3),
            Uuid::new_v4(),
            &ciphertext,
            &hex(Sha256::digest(&ciphertext)),
        ))
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM operations")
            .fetch_one(&pool)
            .await
            .expect("operation count"),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM revisions")
            .fetch_one(&pool)
            .await
            .expect("revision count"),
        0
    );
}

#[tokio::test]
async fn push_hides_a_third_party_vault() {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;
    let owner_id = create_user(&pool, "owner@example.test").await;
    let stranger_id = create_user(&pool, "stranger@example.test").await;
    let vault_id = create_vault(&pool, owner_id).await;
    let stranger_session =
        synapse_server::auth::session::create(&pool, stranger_id, SystemTime::now())
            .await
            .expect("session is created");
    let storage = TestStorage::new();
    let app = synapse_server::router_with_blob_store(
        Some(pool.clone()),
        FilesystemBlobStore::open(&storage.path).expect("blob storage opens"),
    );
    let ciphertext = vec![34_u8; 16];

    let hidden = app
        .clone()
        .oneshot(push_request(
            vault_id,
            &stranger_session.cookie_value(),
            uuid_v7(4),
            Uuid::new_v4(),
            &ciphertext,
            &hex(Sha256::digest(&ciphertext)),
        ))
        .await
        .expect("response");
    assert_eq!(hidden.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM operations")
            .fetch_one(&pool)
            .await
            .expect("operation count"),
        0
    );
}

#[tokio::test]
async fn owner_push_rejects_invalid_opaque_payloads_without_persisting_state() {
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
        .expect("session is created");
    let storage = TestStorage::new();
    let app = synapse_server::router_with_blob_store(
        Some(pool.clone()),
        FilesystemBlobStore::open(&storage.path).expect("blob storage opens"),
    );
    let ciphertext = vec![34_u8; 16];
    let valid_hash = hex(Sha256::digest(&ciphertext));
    let payload = push_payload(
        vault_id,
        uuid_v7(5),
        Uuid::new_v4(),
        &ciphertext,
        &valid_hash,
    );
    let cases = [
        ("invalid ciphertext hash", StatusCode::BAD_REQUEST, payload.replacen(&valid_hash, &"00".repeat(32), 1)),
        ("plaintext field", StatusCode::BAD_REQUEST, format!("{},\"markdown\":\"plaintext\"}}", payload.strip_suffix('}').expect("payload ends with an object"))),
        ("UUIDv4 operation id", StatusCode::BAD_REQUEST, payload.replacen(&uuid_v7(5).to_string(), &Uuid::new_v4().to_string(), 1)),
        ("malformed operation id", StatusCode::BAD_REQUEST, payload.replacen(&uuid_v7(5).to_string(), "not-a-uuid", 1)),
        ("malformed nonce", StatusCode::BAD_REQUEST, payload.replacen("\"nonce\":[17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17]", "\"nonce\":[17]", 1)),
        ("invalid AAD version", StatusCode::BAD_REQUEST, payload.replacen("\"aad_version\":1", "\"aad_version\":2", 1)),
        ("invalid protocol version", StatusCode::BAD_REQUEST, payload.replacen("\"protocol_version\":1", "\"protocol_version\":2", 1)),
        ("non-current base revision", StatusCode::CONFLICT, payload.replacen("\"base_revision\":0", "\"base_revision\":1", 1)),
    ];

    for (case, expected_status, payload) in cases {
        let response = app
            .clone()
            .oneshot(push_payload_request(
                vault_id,
                &session.cookie_value(),
                payload,
            ))
            .await
            .expect("router responds");
        assert_eq!(response.status(), expected_status, "{case}");
        assert_sync_state_is_empty(&pool, vault_id).await;
    }
}

#[tokio::test]
async fn genesis_base_push_on_a_non_empty_vault_conflicts_with_a_null_base_hash() {
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
        .expect("session is created");
    let storage = TestStorage::new();
    let app = synapse_server::router_with_blob_store(
        Some(pool.clone()),
        FilesystemBlobStore::open(&storage.path).expect("blob storage opens"),
    );

    let first_ciphertext = vec![77_u8; 16];
    let first_hash = hex(Sha256::digest(&first_ciphertext));
    let first = app
        .clone()
        .oneshot(push_request(
            vault_id,
            &session.cookie_value(),
            uuid_v7(6),
            Uuid::new_v4(),
            &first_ciphertext,
            &first_hash,
        ))
        .await
        .expect("first response");
    assert_eq!(first.status(), StatusCode::CREATED);

    let offline_ciphertext = vec![41_u8; 16];
    let offline_hash = hex(Sha256::digest(&offline_ciphertext));
    let conflict = app
        .oneshot(push_request(
            vault_id,
            &session.cookie_value(),
            uuid_v7(7),
            Uuid::new_v4(),
            &offline_ciphertext,
            &offline_hash,
        ))
        .await
        .expect("conflict response");

    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    let body = conflict
        .into_body()
        .collect()
        .await
        .expect("conflict body is readable")
        .to_bytes();
    let body: serde_json::Value =
        serde_json::from_slice(&body).expect("conflict body is valid json");
    assert_eq!(body["base_revision"], 0);
    assert_eq!(body["remote_revision"], 1);
    assert_eq!(body["base_ciphertext_hash"], "00".repeat(32));
    assert_eq!(body["local_ciphertext_hash"], offline_hash);
    assert_eq!(body["remote_ciphertext_hash"], first_hash);
}

struct FailingBlobStore;

impl synapse_server::blob::BlobStore for FailingBlobStore {
    fn put_ciphertext(
        &self,
        _: &[u8],
        _: &[u8],
        _: &synapse_server::blob::CiphertextHash,
    ) -> Result<(), synapse_server::blob::BlobStoreError> {
        Err(synapse_server::blob::BlobStoreError::InvalidBlob)
    }

    fn get_ciphertext(
        &self,
        _: &synapse_server::blob::CiphertextHash,
    ) -> Result<Option<synapse_server::blob::StoredCiphertext>, synapse_server::blob::BlobStoreError>
    {
        Ok(None)
    }

    fn exists(
        &self,
        _: &synapse_server::blob::CiphertextHash,
    ) -> Result<bool, synapse_server::blob::BlobStoreError> {
        Ok(false)
    }

    fn delete_unreferenced(
        &self,
        _: &std::collections::HashSet<synapse_server::blob::CiphertextHash>,
    ) -> Result<usize, synapse_server::blob::BlobStoreError> {
        Ok(0)
    }
}

fn push_request(
    vault_id: Uuid,
    session: &str,
    operation_id: Uuid,
    note_id: Uuid,
    ciphertext: &[u8],
    ciphertext_hash: &str,
) -> Request<Body> {
    push_payload_request(
        vault_id,
        session,
        push_payload(vault_id, operation_id, note_id, ciphertext, ciphertext_hash),
    )
}

fn push_payload(
    vault_id: Uuid,
    operation_id: Uuid,
    note_id: Uuid,
    ciphertext: &[u8],
    ciphertext_hash: &str,
) -> String {
    let ciphertext = ciphertext
        .iter()
        .map(u8::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let nonce = std::iter::repeat_n("17", 24).collect::<Vec<_>>().join(",");
    format!(
        r#"{{"protocol_version":1,"operation_id":"{operation_id}","vault_id":"{vault_id}","note_id":"{note_id}","base_revision":0,"ciphertext":[{ciphertext}],"nonce":[{nonce}],"aad_version":1,"ciphertext_hash":"{ciphertext_hash}"}}"#
    )
}

fn push_payload_request(vault_id: Uuid, session: &str, payload: String) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(format!("/v1/vaults/{vault_id}/operations"))
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::ORIGIN, "https://synapse.local")
        .header(header::COOKIE, format!("session={session}"))
        .body(Body::from(payload))
        .expect("request is valid")
}

async fn assert_sync_state_is_empty(pool: &sqlx::PgPool, vault_id: Uuid) {
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM operations")
            .fetch_one(pool)
            .await
            .expect("operation count"),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM revisions")
            .fetch_one(pool)
            .await
            .expect("revision count"),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT current_revision FROM vaults WHERE id = $1::uuid")
            .bind(vault_id.to_string())
            .fetch_one(pool)
            .await
            .expect("current revision"),
        0
    );
}

fn uuid_v7(sequence: u128) -> Uuid {
    Uuid::from_u128(0x018f_1234_5678_7000_8000_0000_0000_0000 + sequence)
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

fn hex(bytes: impl AsRef<[u8]>) -> String {
    bytes
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
