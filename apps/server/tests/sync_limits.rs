use std::{
    convert::Infallible,
    sync::Arc,
    time::{Duration, SystemTime},
};

use axum::{
    body::{Body, Bytes},
    http::{Request, StatusCode, header},
};
use futures_util::stream;
use http_body_util::BodyExt;
use rand::RngCore;
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

mod common;

#[tokio::test]
async fn saturated_sync_boundary_rejects_a_fifth_payload_before_json_decoding_and_releases_after_completion()
 {
    let barrier = Arc::new(tokio::sync::Barrier::new(5));
    let release = Arc::new(tokio::sync::Notify::new());
    let app = synapse_server::router(None);

    let mut admitted = Vec::new();
    for _ in 0..4 {
        admitted.push(tokio::spawn(
            app.clone()
                .oneshot(held_push_request(barrier.clone(), release.clone())),
        ));
    }
    barrier.wait().await;

    let saturated = tokio::time::timeout(
        Duration::from_millis(100),
        app.clone().oneshot(malformed_push_request()),
    )
    .await
    .expect("a saturated boundary rejects before reading JSON")
    .expect("router responds");
    assert_eq!(saturated.status(), StatusCode::SERVICE_UNAVAILABLE);

    for _ in 0..4 {
        release.notify_one();
    }
    for task in admitted {
        let completed = task
            .await
            .expect("held request joins")
            .expect("router responds");
        assert_eq!(completed.status(), StatusCode::BAD_REQUEST);
    }

    let after_release = app
        .oneshot(malformed_push_request())
        .await
        .expect("router responds");
    assert_eq!(after_release.status(), StatusCode::BAD_REQUEST);
}

fn held_push_request(
    barrier: Arc<tokio::sync::Barrier>,
    release: Arc<tokio::sync::Notify>,
) -> Request<Body> {
    let stream = stream::once(async move {
        barrier.wait().await;
        release.notified().await;
        Ok::<_, Infallible>(Bytes::from_static(b"{"))
    });
    Request::builder()
        .method("POST")
        .uri("/v1/vaults/00000000-0000-0000-0000-000000000000/operations")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::ORIGIN, "https://synapse.local")
        .body(Body::from_stream(stream))
        .expect("request is valid")
}

fn malformed_push_request() -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/v1/vaults/00000000-0000-0000-0000-000000000000/operations")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::ORIGIN, "https://synapse.local")
        .body(Body::from("{"))
        .expect("request is valid")
}

#[tokio::test]
async fn bounded_opaque_sync_load_rejects_excess_before_decoding_releases_every_slot_and_pages_authorized_pull()
 {
    let _guard = sync_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_sync_tables(&pool).await;

    let owner_id = create_user(&pool).await;
    let other_user_id = create_user(&pool).await;
    let vault_id = create_vault(&pool, owner_id).await;
    for revision in 1..=2 {
        let mut ciphertext = vec![0; synapse_server::sync::apply::MAX_CIPHERTEXT_BYTES];
        rand::thread_rng().fill_bytes(&mut ciphertext);
        insert_operation(&pool, vault_id, revision, ciphertext).await;
    }
    let owner_session = synapse_server::auth::session::create(&pool, owner_id, SystemTime::now())
        .await
        .expect("owner session is created");
    let other_session =
        synapse_server::auth::session::create(&pool, other_user_id, SystemTime::now())
            .await
            .expect("other session is created");
    let app = synapse_server::router(Some(pool));

    let entered = Arc::new(tokio::sync::Barrier::new(5));
    let mut releases = Vec::new();
    let mut admitted = Vec::new();
    for _ in 0..4 {
        let (release, receiver) = tokio::sync::oneshot::channel();
        releases.push(release);
        admitted.push(tokio::spawn(
            app.clone()
                .oneshot(controlled_push_request(entered.clone(), receiver)),
        ));
    }
    entered.wait().await;

    let (first_rejection, second_rejection) = tokio::join!(
        app.clone().oneshot(malformed_push_request()),
        app.clone().oneshot(malformed_push_request()),
    );
    for rejection in [first_rejection, second_rejection] {
        let rejection = rejection.expect("router responds");
        assert_eq!(rejection.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert!(
            rejection
                .into_body()
                .collect()
                .await
                .expect("rejection body is readable")
                .to_bytes()
                .is_empty()
        );
    }

    for release in releases {
        release.send(()).expect("controlled body is still held");
    }
    for request in admitted {
        assert_eq!(
            request
                .await
                .expect("admitted request joins")
                .expect("router responds")
                .status(),
            StatusCode::BAD_REQUEST
        );
    }

    let hidden = app
        .clone()
        .oneshot(pull_request(vault_id, &other_session.cookie_value(), None))
        .await
        .expect("router responds");
    assert_eq!(hidden.status(), StatusCode::NOT_FOUND);
    assert!(
        hidden
            .into_body()
            .collect()
            .await
            .expect("hidden body is readable")
            .to_bytes()
            .is_empty()
    );

    let first_page = pull_body(
        app.clone()
            .oneshot(pull_request(vault_id, &owner_session.cookie_value(), None))
            .await
            .expect("first pull responds"),
    )
    .await;
    assert!(first_page.len() > synapse_server::sync::pull::MAX_PULL_RESPONSE_BYTES / 2);
    assert!(first_page.len() <= synapse_server::sync::pull::MAX_PULL_RESPONSE_BYTES);
    let first_page: serde_json::Value =
        serde_json::from_slice(&first_page).expect("first page is JSON");
    assert_eq!(
        first_page["operations"]
            .as_array()
            .expect("operations array")
            .len(),
        1
    );
    let cursor = first_page["next_cursor"]
        .as_str()
        .expect("bounded page advances the opaque cursor")
        .to_owned();

    let second_page = pull_body(
        app.oneshot(pull_request(
            vault_id,
            &owner_session.cookie_value(),
            Some(&cursor),
        ))
        .await
        .expect("second pull responds"),
    )
    .await;
    assert!(second_page.len() > synapse_server::sync::pull::MAX_PULL_RESPONSE_BYTES / 2);
    assert!(second_page.len() <= synapse_server::sync::pull::MAX_PULL_RESPONSE_BYTES);
    let second_page: serde_json::Value =
        serde_json::from_slice(&second_page).expect("second page is JSON");
    assert_eq!(
        second_page["operations"]
            .as_array()
            .expect("operations array")
            .len(),
        1
    );
    assert_ne!(
        first_page["operations"][0]["operation_id"],
        second_page["operations"][0]["operation_id"]
    );
}

fn controlled_push_request(
    entered: Arc<tokio::sync::Barrier>,
    release: tokio::sync::oneshot::Receiver<()>,
) -> Request<Body> {
    let stream = stream::once(async move {
        entered.wait().await;
        release.await.expect("test releases the controlled body");
        Ok::<_, Infallible>(Bytes::from_static(b"{"))
    });
    Request::builder()
        .method("POST")
        .uri("/v1/vaults/00000000-0000-0000-0000-000000000000/operations")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::ORIGIN, "https://synapse.local")
        .body(Body::from_stream(stream))
        .expect("request is valid")
}

fn pull_request(vault_id: Uuid, session: &str, cursor: Option<&str>) -> Request<Body> {
    let cursor = cursor.map_or_else(String::new, |cursor| format!("cursor={cursor}&"));
    Request::builder()
        .method("GET")
        .uri(format!("/v1/vaults/{vault_id}/operations?{cursor}limit=2"))
        .header(header::COOKIE, format!("session={session}"))
        .body(Body::empty())
        .expect("request is valid")
}

async fn pull_body(response: axum::response::Response) -> axum::body::Bytes {
    assert_eq!(response.status(), StatusCode::OK);
    response
        .into_body()
        .collect()
        .await
        .expect("pull body is readable")
        .to_bytes()
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
        .bind(Vec::<u8>::new())
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

async fn insert_operation(pool: &sqlx::PgPool, vault_id: Uuid, revision: i64, ciphertext: Vec<u8>) {
    let operation_id = Uuid::new_v4();
    let hash = Sha256::digest(&ciphertext).to_vec();
    let mut nonce = vec![0; 24];
    rand::thread_rng().fill_bytes(&mut nonce);
    sqlx::query("INSERT INTO blobs (ciphertext_hash, byte_length) VALUES ($1, $2)")
        .bind(&hash)
        .bind(ciphertext.len() as i64)
        .execute(pool)
        .await
        .expect("blob is stored");
    sqlx::query("INSERT INTO revisions (vault_id, revision, operation_id, ciphertext_hash) VALUES ($1::uuid, $2, $3::uuid, $4)")
        .bind(vault_id.to_string())
        .bind(revision)
        .bind(operation_id.to_string())
        .bind(&hash)
        .execute(pool)
        .await
        .expect("revision is stored");
    sqlx::query("INSERT INTO operations (id, vault_id, base_revision, applied_revision, note_id, ciphertext, nonce, ciphertext_hash) VALUES ($1::uuid, $2::uuid, 0, $3, $4::uuid, $5, $6, $7)")
        .bind(operation_id.to_string())
        .bind(vault_id.to_string())
        .bind(revision)
        .bind(Uuid::new_v4().to_string())
        .bind(ciphertext)
        .bind(nonce)
        .bind(hash)
        .execute(pool)
        .await
        .expect("operation is stored");
    sqlx::query("UPDATE vaults SET current_revision = $1 WHERE id = $2::uuid")
        .bind(revision)
        .bind(vault_id.to_string())
        .execute(pool)
        .await
        .expect("vault revision is updated");
}
