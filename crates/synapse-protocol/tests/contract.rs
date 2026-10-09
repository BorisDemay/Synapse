use synapse_protocol::v1::{
    Conflict, EncryptedPushOperation, MAX_PULL_LIMIT, PullRequest, PullResponse,
    ResnapshotRequired, SyncCursor, openapi_document,
};

const PLAINTEXT_FIXTURE: &str = "# note secrète";

fn fixture_encrypted_operation() -> EncryptedPushOperation {
    EncryptedPushOperation {
        protocol_version: 1,
        operation_id: "0198e5de-aaaa-7bbb-8ccc-ddddeeeeffff".into(),
        vault_id: "0198e5de-1111-7222-8333-444455556666".into(),
        note_id: "0198e5de-7777-7888-8999-aaaabbbbcccc".into(),
        base_revision: 4,
        ciphertext: vec![212; 16],
        nonce: vec![17; 24],
        aad_version: 1,
        ciphertext_hash: "f6d6f3ae0fc5e8a4feab46c293fe3d15eb34d8f5ca2dd01fc2cad6df1ddf6fb2".into(),
        encrypted_vault_key_envelope: None,
    }
}

#[test]
fn encrypted_push_json_never_contains_plaintext() {
    let value = serde_json::to_value(fixture_encrypted_operation()).expect("operation serializes");

    assert_eq!(value["protocol_version"], 1);
    assert!(value.get("operation_id").is_some());
    assert!(value.get("base_revision").is_some());
    assert!(value.get("ciphertext").is_some());
    assert!(!value.to_string().contains(PLAINTEXT_FIXTURE));
}

#[test]
fn sync_contracts_round_trip_without_unknown_fields() {
    let operation = fixture_encrypted_operation();
    let request = PullRequest {
        protocol_version: 1,
        vault_id: operation.vault_id.clone(),
        cursor: Some(
            SyncCursor::new("0198e5de-9999-7aaa-8bbb-ccccddddeeee").expect("valid cursor"),
        ),
        limit: 100,
    };
    let response = PullResponse {
        protocol_version: 1,
        operations: vec![operation.clone()],
        next_cursor: Some(
            SyncCursor::new("0198e5de-eeee-7fff-8000-111122223333").expect("valid cursor"),
        ),
    };
    let resnapshot = ResnapshotRequired::new();
    let conflict = Conflict {
        protocol_version: 1,
        operation_id: operation.operation_id.clone(),
        vault_id: operation.vault_id.clone(),
        note_id: operation.note_id.clone(),
        base_revision: 4,
        remote_revision: 5,
        base_ciphertext_hash: "00".repeat(32),
        local_ciphertext_hash: operation.ciphertext_hash.clone(),
        remote_ciphertext_hash: "11".repeat(32),
    };

    for value in [
        serde_json::to_value(&operation).expect("operation serializes"),
        serde_json::to_value(&request).expect("request serializes"),
        serde_json::to_value(&response).expect("response serializes"),
        serde_json::to_value(&resnapshot).expect("resnapshot error serializes"),
        serde_json::to_value(&conflict).expect("conflict serializes"),
    ] {
        assert!(!value.to_string().contains(PLAINTEXT_FIXTURE));
    }

    let operation_json = serde_json::to_string(&operation).expect("operation serializes");
    let decoded: EncryptedPushOperation =
        serde_json::from_str(&operation_json).expect("operation deserializes");
    assert_eq!(decoded, operation);

    let rejected = serde_json::from_str::<PullRequest>(
        r#"{"protocol_version":1,"vault_id":"vault","cursor":null,"limit":1,"title":"secret"}"#,
    );
    assert!(rejected.is_err(), "unknown plaintext fields are rejected");

    let invalid_cursor = serde_json::from_str::<PullRequest>(
        r#"{"protocol_version":1,"vault_id":"vault","cursor":"\n","limit":1}"#,
    );
    assert!(
        invalid_cursor.is_err(),
        "invalid cursors are rejected at the boundary"
    );

    let limit_above_ceiling = serde_json::from_str::<PullRequest>(&format!(
        r#"{{"protocol_version":1,"vault_id":"0198e5de-1111-7222-8333-444455556666","cursor":null,"limit":{}}}"#,
        MAX_PULL_LIMIT + 1,
    ));
    assert!(
        limit_above_ceiling.is_err(),
        "pull pages have a fixed ceiling"
    );
}

#[test]
fn resnapshot_error_is_closed_opaque_and_instructs_null_cursor_retry() {
    let error = ResnapshotRequired::new();
    let value = serde_json::to_value(&error).expect("resnapshot error serializes");

    assert_eq!(value["protocol_version"], 1);
    assert_eq!(value["code"], "sync_cursor_resnapshot_required");
    assert_eq!(value["resnapshot_cursor"], serde_json::Value::Null);
    assert!(!value.to_string().contains(PLAINTEXT_FIXTURE));

    let decoded: ResnapshotRequired = serde_json::from_value(value).expect("error deserializes");
    assert_eq!(decoded, error);

    for payload in [
        r#"{"protocol_version":1,"code":"sync_cursor_resnapshot_required","resnapshot_cursor":null,"title":"secret"}"#,
        r#"{"protocol_version":1,"code":"other","resnapshot_cursor":null}"#,
        r#"{"protocol_version":1,"code":"sync_cursor_resnapshot_required","resnapshot_cursor":"0198e5de-9999-7aaa-8bbb-ccccddddeeee"}"#,
    ] {
        assert!(
            serde_json::from_str::<ResnapshotRequired>(payload).is_err(),
            "resnapshot errors reject unknown fields and mutable instructions"
        );
    }
}

#[test]
fn encrypted_push_accepts_zero_base_revision_used_by_the_web_client() {
    let mut operation = fixture_encrypted_operation();
    operation.base_revision = 0;
    let json = serde_json::to_string(&operation).expect("operation serializes");
    let decoded: EncryptedPushOperation =
        serde_json::from_str(&json).expect("first web revision uses base_revision 0");
    assert_eq!(decoded.base_revision, 0);
}

#[test]
fn deserialization_rejects_plaintext_identifiers_and_invalid_crypto_metadata() {
    let invalid_identifier = serde_json::from_str::<EncryptedPushOperation>(
        r##"{"protocol_version":1,"operation_id":"# note secrète","vault_id":"0198e5de-1111-7222-8333-444455556666","note_id":"0198e5de-7777-7888-8999-aaaabbbbcccc","base_revision":4,"ciphertext":[1,2,3],"nonce":[17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17],"aad_version":1,"ciphertext_hash":"f6d6f3ae0fc5e8a4feab46c293fe3d15eb34d8f5ca2dd01fc2cad6df1ddf6fb2"}"##,
    );
    assert!(invalid_identifier.is_err());

    let invalid_metadata = serde_json::from_str::<EncryptedPushOperation>(
        r#"{"protocol_version":2,"operation_id":"0198e5de-aaaa-7bbb-8ccc-ddddeeeeffff","vault_id":"0198e5de-1111-7222-8333-444455556666","note_id":"0198e5de-7777-7888-8999-aaaabbbbcccc","base_revision":0,"ciphertext":[1,2,3],"nonce":[17],"aad_version":0,"ciphertext_hash":"not-a-hash"}"#,
    );
    assert!(invalid_metadata.is_err());

    let plaintext_cursor = serde_json::from_str::<PullRequest>(
        r##"{"protocol_version":1,"vault_id":"0198e5de-1111-7222-8333-444455556666","cursor":"# note secrète","limit":1}"##,
    );
    assert!(plaintext_cursor.is_err());
}

#[test]
fn generated_openapi_document_is_stable_and_exposes_only_opaque_payloads() {
    let generated = serde_json::to_string_pretty(&openapi_document()).expect("OpenAPI serializes");
    let checked_in = include_str!("../schema/openapi.json").trim_end();

    assert_eq!(generated, checked_in);
    assert!(!generated.contains(PLAINTEXT_FIXTURE));
    let properties =
        &openapi_document()["components"]["schemas"]["EncryptedPushOperation"]["properties"];
    assert!(properties.get("markdown").is_none());
    assert!(properties.get("title").is_none());
    assert!(properties.get("path").is_none());
    let pull_request = &openapi_document()["components"]["schemas"]["PullRequest"];
    assert_eq!(pull_request["additionalProperties"], false);
    assert_eq!(
        pull_request["properties"]["limit"]["maximum"],
        MAX_PULL_LIMIT
    );
    assert_eq!(
        openapi_document()["paths"]["/v1/vaults/{vault_id}/operations"]["get"]["responses"]["409"]
            ["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/ResnapshotRequired"
    );
    for schema in [
        "SessionResponse",
        "VaultListResponse",
        "VaultKeyEnvelope",
        "PullRequest",
        "PullResponse",
        "ResnapshotRequired",
        "Conflict",
    ] {
        assert!(
            openapi_document()["components"]["schemas"][schema]["properties"]
                .as_object()
                .is_some_and(|properties| !properties.is_empty())
        );
    }
    assert_eq!(
        openapi_document()["paths"]["/v1/session"]["get"]["responses"]["200"]["content"]["application/json"]
            ["schema"]["$ref"],
        "#/components/schemas/SessionResponse"
    );
    assert_eq!(
        openapi_document()["paths"]["/v1/vaults"]["get"]["responses"]["200"]["content"]["application/json"]
            ["schema"]["$ref"],
        "#/components/schemas/VaultListResponse"
    );
    assert_eq!(
        openapi_document()["paths"]["/v1/vaults/{vault_id}/envelope"]["get"]["responses"]["200"]["content"]
            ["application/json"]["schema"]["$ref"],
        "#/components/schemas/VaultKeyEnvelope"
    );
    assert_eq!(
        openapi_document()["paths"]["/v1/vaults/{vault_id}/operations"]["get"]["parameters"][1]["name"],
        "limit"
    );
}
