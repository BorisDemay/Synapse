use std::{sync::OnceLock, time::SystemTime};

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn authenticated_owner_pulls_opaque_operations_in_strict_revision_order() {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;

    let owner_id = create_user(&pool, "owner@example.test").await;
    let vault_id = create_vault(&pool, owner_id).await;
    insert_operation(&pool, vault_id, 2, uuid_v7(2), vec![212; 16]).await;
    insert_operation(&pool, vault_id, 1, uuid_v7(1), vec![91; 16]).await;
    let session = synapse_server::auth::session::create(&pool, owner_id, SystemTime::now())
        .await
        .expect("session is created");
    let app = synapse_server::router(Some(pool.clone()));

    let response = app
        .oneshot(pull_request(vault_id, &session.cookie_value(), None, 2))
        .await
        .expect("router responds");

    assert_eq!(response.status(), StatusCode::OK);
    let body = response
        .into_body()
        .collect()
        .await
        .expect("response body is readable")
        .to_bytes();
    let response: serde_json::Value = serde_json::from_slice(&body).expect("response is JSON");
    assert_eq!(response["protocol_version"], 1);
    assert_eq!(
        response["operations"]
            .as_array()
            .expect("operations array")
            .len(),
        2
    );
    assert_eq!(
        response["operations"][0]["operation_id"],
        uuid_v7(1).to_string()
    );
    assert_eq!(
        response["operations"][1]["operation_id"],
        uuid_v7(2).to_string()
    );
    assert_eq!(
        response["operations"][0]["ciphertext"],
        serde_json::json!(vec![91; 16])
    );
    assert_eq!(
        response["operations"][1]["ciphertext"],
        serde_json::json!(vec![212; 16])
    );
    assert!(response["next_cursor"].as_str().is_some());
    assert!(response.get("markdown").is_none());
    assert!(response.get("title").is_none());
}

#[tokio::test]
async fn unknown_cursor_returns_only_the_closed_resnapshot_body() {
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
    let unknown_cursor = Uuid::new_v4().to_string();
    let response = synapse_server::router(Some(pool))
        .oneshot(pull_request(
            vault_id,
            &session.cookie_value(),
            Some(&unknown_cursor),
            1,
        ))
        .await
        .expect("router responds");

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes(),
        r#"{"protocol_version":1,"code":"sync_cursor_resnapshot_required","resnapshot_cursor":null}"#
    );
}

#[tokio::test]
async fn pagination_resumes_from_the_persisted_opaque_cursor_without_a_duplicate() {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;
    let owner_id = create_user(&pool, "owner@example.test").await;
    let vault_id = create_vault(&pool, owner_id).await;
    insert_operation(&pool, vault_id, 1, uuid_v7(1), vec![91; 16]).await;
    insert_operation(&pool, vault_id, 2, uuid_v7(2), vec![212; 16]).await;
    let session = synapse_server::auth::session::create(&pool, owner_id, SystemTime::now())
        .await
        .expect("session is created");
    let app = synapse_server::router(Some(pool.clone()));

    let first = app
        .clone()
        .oneshot(pull_request(vault_id, &session.cookie_value(), None, 1))
        .await
        .expect("first page");
    let first: serde_json::Value = serde_json::from_slice(
        &first
            .into_body()
            .collect()
            .await
            .expect("first body")
            .to_bytes(),
    )
    .expect("first JSON");
    let cursor = first["next_cursor"]
        .as_str()
        .expect("next cursor")
        .to_owned();
    let second = app
        .oneshot(pull_request(
            vault_id,
            &session.cookie_value(),
            Some(&cursor),
            1,
        ))
        .await
        .expect("second page");
    let second: serde_json::Value = serde_json::from_slice(
        &second
            .into_body()
            .collect()
            .await
            .expect("second body")
            .to_bytes(),
    )
    .expect("second JSON");

    assert_eq!(
        first["operations"][0]["operation_id"],
        uuid_v7(1).to_string()
    );
    assert_eq!(
        second["operations"][0]["operation_id"],
        uuid_v7(2).to_string()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT revision FROM sync_cursors WHERE id = $1::uuid")
            .bind(cursor)
            .fetch_one(&pool)
            .await
            .expect("cursor is persisted"),
        1
    );
}

fn pull_request(vault_id: Uuid, session: &str, cursor: Option<&str>, limit: u32) -> Request<Body> {
    let cursor = cursor.map_or_else(|| "null".to_owned(), |cursor| format!("\"{cursor}\""));
    Request::builder()
        .method("GET")
        .uri(format!("/v1/vaults/{vault_id}/operations"))
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::COOKIE, format!("session={session}"))
        .body(Body::from(format!(
            r#"{{"protocol_version":1,"vault_id":"{vault_id}","cursor":{cursor},"limit":{limit}}}"#
        )))
        .expect("request is valid")
}

async fn insert_operation(
    pool: &sqlx::PgPool,
    vault_id: Uuid,
    revision: i64,
    operation_id: Uuid,
    ciphertext: Vec<u8>,
) {
    let hash = vec![revision as u8; 32];
    sqlx::query("INSERT INTO blobs (ciphertext_hash, byte_length) VALUES ($1, $2)")
        .bind(&hash)
        .bind(ciphertext.len() as i64)
        .execute(pool)
        .await
        .expect("blob is stored");
    sqlx::query(
        "INSERT INTO revisions (vault_id, revision, operation_id, ciphertext_hash) \
         VALUES ($1::uuid, $2, $3::uuid, $4)",
    )
    .bind(vault_id.to_string())
    .bind(revision)
    .bind(operation_id.to_string())
    .bind(&hash)
    .execute(pool)
    .await
    .expect("revision is stored");
    sqlx::query(
        "INSERT INTO operations \
         (id, vault_id, base_revision, applied_revision, note_id, ciphertext, nonce, ciphertext_hash) \
         VALUES ($1::uuid, $2::uuid, 0, $3, $4::uuid, $5, $6, $7)",
    )
    .bind(operation_id.to_string())
    .bind(vault_id.to_string())
    .bind(revision)
    .bind(Uuid::new_v4().to_string())
    .bind(ciphertext)
    .bind(vec![17_u8; 24])
    .bind(hash)
    .execute(pool)
    .await
    .expect("operation is stored");
    sqlx::query(
        "UPDATE vaults SET current_revision = GREATEST(current_revision, $1) WHERE id = $2::uuid",
    )
    .bind(revision)
    .bind(vault_id.to_string())
    .execute(pool)
    .await
    .expect("vault revision is updated");
}

fn uuid_v7(sequence: u128) -> Uuid {
    Uuid::from_u128(0x018f_1234_5678_7000_8000_0000_0000_0000 + sequence)
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
        "TRUNCATE operations, revisions, blobs, sync_cursors, vault_members, vaults, sessions, users CASCADE",
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
