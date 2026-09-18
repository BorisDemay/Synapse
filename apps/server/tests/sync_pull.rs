use std::time::SystemTime;

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use rand::RngCore;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

mod common;

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
async fn null_cursor_resnapshots_from_revision_zero_when_retention_starts_later() {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;

    let owner_id = create_user(&pool, "owner@example.test").await;
    let vault_id = create_vault(&pool, owner_id).await;
    insert_operation(&pool, vault_id, 2, uuid_v7(2), vec![212; 16]).await;
    let session = synapse_server::auth::session::create(&pool, owner_id, SystemTime::now())
        .await
        .expect("session is created");

    let response = synapse_server::router(Some(pool))
        .oneshot(pull_request(vault_id, &session.cookie_value(), None, 1))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::OK);
    let response: serde_json::Value = serde_json::from_slice(
        &response
            .into_body()
            .collect()
            .await
            .expect("response body is readable")
            .to_bytes(),
    )
    .expect("response is JSON");
    assert_eq!(
        response["operations"][0]["operation_id"],
        uuid_v7(2).to_string()
    );
}

#[tokio::test]
async fn pull_limit_accepts_protocol_bounds_and_rejects_outside_them() {
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
    let app = synapse_server::router(Some(pool));

    for (limit, expected_status) in [
        (0, StatusCode::BAD_REQUEST),
        (1, StatusCode::OK),
        (100, StatusCode::OK),
        (101, StatusCode::BAD_REQUEST),
    ] {
        let response = app
            .clone()
            .oneshot(pull_request(vault_id, &session.cookie_value(), None, limit))
            .await
            .expect("router responds");
        assert_eq!(response.status(), expected_status, "limit {limit}");
    }
}

#[tokio::test]
async fn cursor_cannot_resume_for_a_different_authorized_user_or_vault() {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;

    let owner_id = create_user(&pool, "owner@example.test").await;
    let other_user_id = create_user(&pool, "other@example.test").await;
    let vault_id = create_vault(&pool, owner_id).await;
    let other_vault_id = create_vault(&pool, owner_id).await;
    add_member(&pool, vault_id, other_user_id).await;
    insert_operation(&pool, vault_id, 1, uuid_v7(1), vec![91; 16]).await;
    let owner_session = synapse_server::auth::session::create(&pool, owner_id, SystemTime::now())
        .await
        .expect("owner session is created");
    let other_session =
        synapse_server::auth::session::create(&pool, other_user_id, SystemTime::now())
            .await
            .expect("other session is created");
    let app = synapse_server::router(Some(pool));

    let first: serde_json::Value = serde_json::from_slice(
        &app.clone()
            .oneshot(pull_request(
                vault_id,
                &owner_session.cookie_value(),
                None,
                1,
            ))
            .await
            .expect("first page")
            .into_body()
            .collect()
            .await
            .expect("first body")
            .to_bytes(),
    )
    .expect("first page is JSON");
    let cursor = first["next_cursor"].as_str().expect("cursor is issued");

    assert_resnapshot_required(
        app.clone()
            .oneshot(pull_request(
                vault_id,
                &other_session.cookie_value(),
                Some(cursor),
                1,
            ))
            .await
            .expect("router responds"),
    )
    .await;
    assert_resnapshot_required(
        app.oneshot(pull_request(
            other_vault_id,
            &owner_session.cookie_value(),
            Some(cursor),
            1,
        ))
        .await
        .expect("router responds"),
    )
    .await;
}

#[tokio::test]
async fn expired_cursor_returns_only_the_closed_resnapshot_body() {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;

    let owner_id = create_user(&pool, "owner@example.test").await;
    let vault_id = create_vault(&pool, owner_id).await;
    let cursor = insert_cursor(&pool, vault_id, owner_id, 0, true).await;
    let session = synapse_server::auth::session::create(&pool, owner_id, SystemTime::now())
        .await
        .expect("session is created");

    assert_resnapshot_required(
        synapse_server::router(Some(pool))
            .oneshot(pull_request(
                vault_id,
                &session.cookie_value(),
                Some(&cursor),
                1,
            ))
            .await
            .expect("router responds"),
    )
    .await;
}

#[tokio::test]
async fn cursor_before_retention_floor_returns_only_the_closed_resnapshot_body() {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;

    let owner_id = create_user(&pool, "owner@example.test").await;
    let vault_id = create_vault(&pool, owner_id).await;
    insert_operation(&pool, vault_id, 2, uuid_v7(2), vec![212; 16]).await;
    let cursor = insert_cursor(&pool, vault_id, owner_id, 0, false).await;
    let session = synapse_server::auth::session::create(&pool, owner_id, SystemTime::now())
        .await
        .expect("session is created");

    assert_resnapshot_required(
        synapse_server::router(Some(pool))
            .oneshot(pull_request(
                vault_id,
                &session.cookie_value(),
                Some(&cursor),
                1,
            ))
            .await
            .expect("router responds"),
    )
    .await;
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

#[tokio::test]
async fn pull_response_budget_keeps_the_first_large_opaque_operation_and_pages_without_gaps() {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;

    let owner_id = create_user(&pool, "member-a@example.test").await;
    let vault_id = create_vault(&pool, owner_id).await;
    let mut first_ciphertext = vec![0; synapse_server::sync::apply::MAX_CIPHERTEXT_BYTES];
    let mut second_ciphertext = vec![0; synapse_server::sync::apply::MAX_CIPHERTEXT_BYTES];
    rand::thread_rng().fill_bytes(&mut first_ciphertext);
    rand::thread_rng().fill_bytes(&mut second_ciphertext);
    insert_operation(&pool, vault_id, 1, uuid_v7(11), first_ciphertext).await;
    insert_operation(&pool, vault_id, 2, uuid_v7(12), second_ciphertext).await;
    let session = synapse_server::auth::session::create(&pool, owner_id, SystemTime::now())
        .await
        .expect("session is created");
    let stranger_id = create_user(&pool, "member-b@example.test").await;
    let stranger_session =
        synapse_server::auth::session::create(&pool, stranger_id, SystemTime::now())
            .await
            .expect("stranger session is created");
    let app = synapse_server::router(Some(pool));

    let hidden = app
        .clone()
        .oneshot(pull_request(
            vault_id,
            &stranger_session.cookie_value(),
            None,
            2,
        ))
        .await
        .expect("hidden vault response");
    assert_eq!(hidden.status(), StatusCode::NOT_FOUND);

    let first_body = app
        .clone()
        .oneshot(pull_request(vault_id, &session.cookie_value(), None, 2))
        .await
        .expect("first page")
        .into_body()
        .collect()
        .await
        .expect("first response body is readable")
        .to_bytes();
    assert!(
        first_body.len() <= synapse_server::sync::pull::MAX_PULL_RESPONSE_BYTES,
        "pull response stays within the response budget"
    );
    let first: serde_json::Value = serde_json::from_slice(&first_body).expect("first page is JSON");
    let cursor = first["next_cursor"]
        .as_str()
        .expect("large first operation produces a cursor")
        .to_owned();
    assert_eq!(
        first["operations"]
            .as_array()
            .expect("operations array")
            .len(),
        1
    );
    assert_eq!(
        first["operations"][0]["operation_id"],
        uuid_v7(11).to_string()
    );

    let second: serde_json::Value = serde_json::from_slice(
        &app.oneshot(pull_request(
            vault_id,
            &session.cookie_value(),
            Some(&cursor),
            2,
        ))
        .await
        .expect("second page")
        .into_body()
        .collect()
        .await
        .expect("second response body is readable")
        .to_bytes(),
    )
    .expect("second page is JSON");
    assert_eq!(
        second["operations"]
            .as_array()
            .expect("operations array")
            .len(),
        1
    );
    assert_eq!(
        second["operations"][0]["operation_id"],
        uuid_v7(12).to_string()
    );
}

fn pull_request(vault_id: Uuid, session: &str, cursor: Option<&str>, limit: u32) -> Request<Body> {
    let cursor = cursor.map_or_else(String::new, |cursor| format!("cursor={cursor}&"));
    Request::builder()
        .method("GET")
        .uri(format!(
            "/v1/vaults/{vault_id}/operations?{cursor}limit={limit}"
        ))
        .header(header::COOKIE, format!("session={session}"))
        .body(Body::empty())
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
        "TRUNCATE operations, revisions, blobs, sync_cursors, vault_members, vaults, sessions, users CASCADE",
    )
    .execute(pool)
    .await
    .expect("sync tables reset");
}

async fn assert_resnapshot_required(response: axum::response::Response) {
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        response
            .into_body()
            .collect()
            .await
            .expect("response body is readable")
            .to_bytes(),
        r#"{"protocol_version":1,"code":"sync_cursor_resnapshot_required","resnapshot_cursor":null}"#
    );
}

async fn insert_cursor(
    pool: &sqlx::PgPool,
    vault_id: Uuid,
    user_id: Uuid,
    revision: i64,
    expired: bool,
) -> String {
    let cursor = Uuid::new_v4().to_string();
    let query = if expired {
        "INSERT INTO sync_cursors (id, vault_id, user_id, revision, expires_at) \
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, CURRENT_TIMESTAMP - INTERVAL '1 second')"
    } else {
        "INSERT INTO sync_cursors (id, vault_id, user_id, revision, expires_at) \
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, CURRENT_TIMESTAMP + INTERVAL '1 day')"
    };
    sqlx::query(query)
        .bind(&cursor)
        .bind(vault_id.to_string())
        .bind(user_id.to_string())
        .bind(revision)
        .execute(pool)
        .await
        .expect("cursor is stored");
    cursor
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
