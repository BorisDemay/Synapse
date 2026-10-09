use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

mod common;

#[tokio::test]
async fn authenticated_user_creates_an_opaque_private_vault_as_its_only_owner() {
    let _guard = vault_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_vault_tables(&pool).await;

    let user_id = create_user(&pool, "owner@example.test").await;
    let session =
        synapse_server::auth::session::create(&pool, user_id, std::time::SystemTime::now())
            .await
            .expect("session is created");
    let app = synapse_server::router(Some(pool.clone()));

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/vaults")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::ORIGIN, "https://synapse.local")
                .header(
                    header::COOKIE,
                    format!("session={}", session.cookie_value()),
                )
                .body(Body::from("{}"))
                .expect("request is valid"),
        )
        .await
        .expect("router responds");

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response
        .into_body()
        .collect()
        .await
        .expect("body is readable")
        .to_bytes();
    let vault_id = Uuid::parse_str(
        std::str::from_utf8(&body)
            .expect("response is UTF-8 JSON")
            .strip_prefix("{\"id\":\"")
            .and_then(|value| value.strip_suffix("\"}"))
            .expect("response contains only a vault UUID"),
    )
    .expect("vault ID is valid");

    let stored = sqlx::query_as::<_, (String, i64)>(
        "SELECT id::text, current_revision FROM vaults WHERE id = $1::uuid",
    )
    .bind(vault_id.to_string())
    .fetch_one(&pool)
    .await
    .expect("vault is stored");
    assert_eq!(stored, (vault_id.to_string(), 0));
    let members = sqlx::query_as::<_, (String, String, String)>(
        "SELECT vault_id::text, user_id::text, role FROM vault_members WHERE vault_id = $1::uuid",
    )
    .bind(vault_id.to_string())
    .fetch_all(&pool)
    .await
    .expect("members are stored");
    assert_eq!(
        members,
        vec![(
            vault_id.to_string(),
            user_id.to_string(),
            "owner".to_owned()
        )]
    );
}

#[tokio::test]
async fn vault_reads_require_a_session_and_hide_non_owned_or_unknown_vaults() {
    let _guard = vault_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_vault_tables(&pool).await;

    let owner_id = create_user(&pool, "owner@example.test").await;
    let stranger_id = create_user(&pool, "stranger@example.test").await;
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
    transaction
        .commit()
        .await
        .expect("complete owner state commits");
    let owner_session = create_session(&pool, owner_id).await;
    let stranger_session = create_session(&pool, stranger_id).await;
    let app = synapse_server::router(Some(pool));

    assert_eq!(
        app.clone()
            .oneshot(read_vault(vault_id, None))
            .await
            .expect("response")
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.clone()
            .oneshot(read_vault(vault_id, Some(&stranger_session)))
            .await
            .expect("response")
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.clone()
            .oneshot(read_vault(Uuid::new_v4(), Some(&owner_session)))
            .await
            .expect("response")
            .status(),
        StatusCode::NOT_FOUND
    );
    let owned = app
        .oneshot(read_vault(vault_id, Some(&owner_session)))
        .await
        .expect("response");
    assert_eq!(owned.status(), StatusCode::OK);
    assert_eq!(
        owned
            .into_body()
            .collect()
            .await
            .expect("body is readable")
            .to_bytes(),
        format!(r#"{{"id":"{vault_id}"}}"#)
    );
}

#[tokio::test]
async fn v1_vault_list_and_opaque_envelope_are_authorized_and_csrf_protected() {
    let _guard = vault_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_vault_tables(&pool).await;
    let owner_id = create_user(&pool, "owner@example.test").await;
    let stranger_id = create_user(&pool, "stranger@example.test").await;
    let vault_id = create_complete_vault(&pool, owner_id).await;
    let owner_session = create_session(&pool, owner_id).await;
    let stranger_session = create_session(&pool, stranger_id).await;
    let app = synapse_server::router(Some(pool));

    let listed = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/vaults")
                .header(header::COOKIE, format!("session={owner_session}"))
                .body(Body::empty())
                .expect("request is valid"),
        )
        .await
        .expect("response");
    assert_eq!(listed.status(), StatusCode::OK);
    assert_eq!(
        listed.into_body().collect().await.expect("body").to_bytes(),
        format!(r#"{{"vaults":[{{"id":"{vault_id}"}}]}}"#)
    );
    assert_eq!(
        app.clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/vaults")
                    .header(header::COOKIE, format!("session={stranger_session}"))
                    .body(Body::empty())
                    .expect("request is valid"),
            )
            .await
            .expect("response")
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes(),
        &br#"{"vaults":[]}"#[..]
    );
    let write = Request::builder()
        .method("PUT")
        .uri(format!("/v1/vaults/{vault_id}/envelope"))
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::ORIGIN, "https://synapse.local")
        .header(header::COOKIE, format!("session={owner_session}"))
        .body(Body::from(r#"{"bytes":[1,2,3,4]}"#))
        .expect("request is valid");
    assert_eq!(
        app.clone().oneshot(write).await.expect("response").status(),
        StatusCode::NO_CONTENT
    );
    let read = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/v1/vaults/{vault_id}/envelope"))
                .header(header::COOKIE, format!("session={owner_session}"))
                .body(Body::empty())
                .expect("request is valid"),
        )
        .await
        .expect("response");
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(
        read.into_body().collect().await.expect("body").to_bytes(),
        &br#"{"bytes":[1,2,3,4]}"#[..]
    );
    assert_eq!(
        app.clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/v1/vaults/{vault_id}/envelope"))
                    .header(header::COOKIE, format!("session={stranger_session}"))
                    .body(Body::empty())
                    .expect("request is valid"),
            )
            .await
            .expect("response")
            .status(),
        StatusCode::NOT_FOUND
    );
    let cross_origin = Request::builder()
        .method("PUT")
        .uri(format!("/v1/vaults/{vault_id}/envelope"))
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::ORIGIN, "https://evil.example")
        .header(header::COOKIE, format!("session={owner_session}"))
        .body(Body::from(r#"{"bytes":[1]}"#))
        .expect("request is valid");
    assert_eq!(
        app.oneshot(cross_origin).await.expect("response").status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn vault_inputs_are_validated_and_database_rejects_orphaned_or_multiple_owner_state() {
    let _guard = vault_test_lock().await;
    let pool = test_pool().await;
    synapse_server::run_migrations(&pool)
        .await
        .expect("migrations apply");
    reset_vault_tables(&pool).await;

    let owner_id = create_user(&pool, "owner@example.test").await;
    let another_user_id = create_user(&pool, "another@example.test").await;
    let session = create_session(&pool, owner_id).await;
    let app = synapse_server::router(Some(pool.clone()));

    assert_eq!(
        app.clone()
            .oneshot(read_raw_vault("not-a-uuid", Some(&session)))
            .await
            .expect("response")
            .status(),
        StatusCode::BAD_REQUEST
    );
    let unknown_json = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/vaults")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::ORIGIN, "https://synapse.local")
                .header(header::COOKIE, format!("session={session}"))
                .body(Body::from(r#"{"title":"plaintext is forbidden"}"#))
                .expect("request is valid"),
        )
        .await
        .expect("response");
    assert!(unknown_json.status().is_client_error());

    let orphaned_vault =
        sqlx::query("INSERT INTO vaults (id, owner_user_id) VALUES ($1::uuid, $2::uuid)")
            .bind(Uuid::new_v4().to_string())
            .bind(owner_id.to_string())
            .execute(&pool)
            .await;
    assert!(
        orphaned_vault.is_err(),
        "a vault cannot commit without its owner membership"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM vaults")
            .fetch_one(&pool)
            .await
            .expect("vault count is readable"),
        0,
        "the rejected orphan does not remain persisted"
    );

    let vault_id = Uuid::new_v4();
    let mut transaction = pool.begin().await.expect("transaction starts");
    sqlx::query("INSERT INTO vaults (id, owner_user_id) VALUES ($1::uuid, $2::uuid)")
        .bind(vault_id.to_string())
        .bind(owner_id.to_string())
        .execute(&mut *transaction)
        .await
        .expect("vault is inserted");
    sqlx::query(
        "INSERT INTO vault_members (vault_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')",
    )
    .bind(vault_id.to_string())
    .bind(owner_id.to_string())
    .execute(&mut *transaction)
    .await
    .expect("matching owner membership is inserted");
    transaction
        .commit()
        .await
        .expect("complete owner state commits");

    let second_owner = sqlx::query(
        "INSERT INTO vault_members (vault_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')",
    )
    .bind(vault_id.to_string())
    .bind(another_user_id.to_string())
    .execute(&pool)
    .await;
    assert!(second_owner.is_err(), "a vault has exactly one owner role");
}

async fn test_pool() -> sqlx::PgPool {
    PgPoolOptions::new()
        .max_connections(5)
        .connect("postgres://postgres@127.0.0.1:55432/synapse_test")
        .await
        .expect("test postgres is available")
}

async fn vault_test_lock() -> common::TestDatabaseLock {
    common::test_database_lock().await
}

async fn reset_vault_tables(pool: &sqlx::PgPool) {
    sqlx::query("TRUNCATE sessions, vault_members, vaults, users CASCADE")
        .execute(pool)
        .await
        .expect("test tables reset");
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

async fn create_session(pool: &sqlx::PgPool, user_id: Uuid) -> String {
    synapse_server::auth::session::create(pool, user_id, std::time::SystemTime::now())
        .await
        .expect("session is created")
        .cookie_value()
}

async fn create_complete_vault(pool: &sqlx::PgPool, owner_id: Uuid) -> Uuid {
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

fn read_vault(vault_id: Uuid, session: Option<&str>) -> Request<Body> {
    read_raw_vault(&vault_id.to_string(), session)
}

fn read_raw_vault(vault_id: &str, session: Option<&str>) -> Request<Body> {
    let mut request = Request::builder()
        .method("GET")
        .uri(format!("/vaults/{vault_id}"));
    if let Some(session) = session {
        request = request.header(header::COOKIE, format!("session={session}"));
    }
    request.body(Body::empty()).expect("request is valid")
}
