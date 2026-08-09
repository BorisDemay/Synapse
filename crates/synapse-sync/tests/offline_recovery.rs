use std::{cell::RefCell, collections::BTreeMap, fs};

use synapse_core::{ContentHash, NoteId, OperationId, Revision, VaultPath};
use synapse_local_store::{IndexedNote, LocalStore, PendingOperation};
use synapse_protocol::v1::{
    Conflict, EncryptedPushOperation, PROTOCOL_VERSION, PullRequest, PullResponse, SyncCursor,
};
use synapse_sync::{
    client::{PullOutcome, PushAck, SyncTransport, TransportError},
    engine::{RetryPolicy, SyncEngine, SyncError, SyncState},
};

const VAULT_ID: &str = "0198e5de-1111-7222-8333-444455556666";

struct OfflineTransport;

impl SyncTransport for OfflineTransport {
    fn push(&self, _: EncryptedPushOperation) -> Result<PushAck, TransportError> {
        Err(TransportError::Network)
    }
}

#[test]
fn network_failure_keeps_the_opaque_pending_operation_in_the_outbox() {
    let store = LocalStore::open_in_memory().expect("store opens");
    let operation = pending_operation();
    store
        .enqueue_operation(&operation)
        .expect("operation persists");
    let mut engine = SyncEngine::new(
        store,
        OfflineTransport,
        VAULT_ID,
        RetryPolicy::without_delay(1),
    );

    let state = engine
        .synchronize()
        .expect("network failure is recoverable");

    assert_eq!(state, SyncState::Pending);
    assert_eq!(
        engine
            .store()
            .pending_operation_count()
            .expect("outbox reads"),
        1
    );
    assert_eq!(
        engine
            .store()
            .pending_operation_payload(&operation.operation_id)
            .expect("outbox reads"),
        Some(operation.payload),
    );
}

#[test]
fn reconnect_consumes_bounded_exponential_jitter_before_acknowledging_the_outbox() {
    let store = LocalStore::open_in_memory().expect("store opens");
    let operation = pending_operation();
    store
        .enqueue_operation(&operation)
        .expect("operation persists");
    let attempts = RefCell::new(0);
    let jitter_bounds = RefCell::new(Vec::new());
    let scheduled_delays = RefCell::new(Vec::new());
    let operation_id = operation.operation_id.to_string();
    let transport = move |_: EncryptedPushOperation| {
        let mut attempts = attempts.borrow_mut();
        *attempts += 1;
        if *attempts < 3 {
            return Err(TransportError::Network);
        }
        Ok(PushAck {
            operation_id: operation_id.clone(),
        })
    };
    let mut engine = SyncEngine::new(
        store,
        transport,
        VAULT_ID,
        RetryPolicy::exponential(
            3,
            100,
            250,
            20,
            |bound| {
                jitter_bounds.borrow_mut().push(bound);
                999
            },
            |delay| scheduled_delays.borrow_mut().push(delay),
        ),
    );

    let state = engine.synchronize().expect("reconnect succeeds");

    assert_eq!(state, SyncState::Synced);
    assert_eq!(jitter_bounds.borrow().as_slice(), &[20, 20]);
    assert_eq!(scheduled_delays.borrow().as_slice(), &[120, 220]);
    assert_eq!(
        engine
            .store()
            .pending_operation_count()
            .expect("outbox reads"),
        0
    );
}

#[test]
fn a_mismatched_ack_keeps_the_operation_in_the_outbox() {
    struct MismatchedAckTransport;

    impl SyncTransport for MismatchedAckTransport {
        fn push(&self, _: EncryptedPushOperation) -> Result<PushAck, TransportError> {
            Ok(PushAck {
                operation_id: OperationId::new().to_string(),
            })
        }
    }

    let store = LocalStore::open_in_memory().expect("store opens");
    let operation = pending_operation();
    store
        .enqueue_operation(&operation)
        .expect("operation persists");
    let mut engine = SyncEngine::new(
        store,
        MismatchedAckTransport,
        VAULT_ID,
        RetryPolicy::without_delay(1),
    );

    assert!(matches!(engine.synchronize(), Err(SyncError::Protocol)));
    assert_eq!(
        engine
            .store()
            .pending_operation_count()
            .expect("outbox reads"),
        1
    );
}

#[test]
fn replay_after_lost_ack_reuses_the_durable_operation_id_and_removes_the_outbox_once() {
    let database_path = std::env::temp_dir().join(format!(
        "synapse-sync-replay-{}.sqlite3",
        OperationId::new()
    ));
    let store = LocalStore::open(&database_path).expect("store opens");
    let operation = pending_operation();
    store
        .enqueue_operation(&operation)
        .expect("operation persists");
    let server = DurableFakeServer::default();
    let first_transport = LostAckTransport {
        server: &server,
        lose_ack: true,
    };
    let mut first_engine = SyncEngine::new(
        store,
        first_transport,
        VAULT_ID,
        RetryPolicy::without_delay(1),
    );

    assert_eq!(
        first_engine
            .synchronize()
            .expect("lost acknowledgement is recoverable"),
        SyncState::Pending
    );
    assert_eq!(
        first_engine
            .store()
            .pending_operation_count()
            .expect("outbox reads"),
        1
    );
    drop(first_engine);

    let second_transport = LostAckTransport {
        server: &server,
        lose_ack: false,
    };
    let mut second_engine = SyncEngine::new(
        LocalStore::open(&database_path).expect("persistent outbox reopens"),
        second_transport,
        VAULT_ID,
        RetryPolicy::without_delay(1),
    );

    assert_eq!(
        second_engine
            .synchronize()
            .expect("durable replay succeeds"),
        SyncState::Synced
    );
    assert_eq!(
        second_engine
            .store()
            .pending_operation_count()
            .expect("outbox reads"),
        0
    );
    assert_eq!(server.durable_application_count(), 1);
    assert_eq!(
        server.received_operation_ids().as_slice(),
        &[
            operation.operation_id.to_string(),
            operation.operation_id.to_string()
        ]
    );
    fs::remove_file(database_path).expect("temporary database removes");
}

#[derive(Default)]
struct DurableFakeServer {
    acknowledgements: RefCell<BTreeMap<String, PushAck>>,
    received_operation_ids: RefCell<Vec<String>>,
}

impl DurableFakeServer {
    fn receive(&self, operation: EncryptedPushOperation) -> PushAck {
        self.received_operation_ids
            .borrow_mut()
            .push(operation.operation_id.clone());
        self.acknowledgements
            .borrow_mut()
            .entry(operation.operation_id.clone())
            .or_insert_with(|| PushAck {
                operation_id: operation.operation_id,
            })
            .clone()
    }

    fn durable_application_count(&self) -> usize {
        self.acknowledgements.borrow().len()
    }

    fn received_operation_ids(&self) -> Vec<String> {
        self.received_operation_ids.borrow().clone()
    }
}

struct LostAckTransport<'a> {
    server: &'a DurableFakeServer,
    lose_ack: bool,
}

impl SyncTransport for LostAckTransport<'_> {
    fn push(&self, operation: EncryptedPushOperation) -> Result<PushAck, TransportError> {
        let acknowledgement = self.server.receive(operation);
        if self.lose_ack {
            Err(TransportError::Network)
        } else {
            Ok(acknowledgement)
        }
    }
}

fn pending_operation() -> PendingOperation {
    let operation_id = OperationId::new();
    let note_id = NoteId::new();
    let payload = serde_json::to_vec(&EncryptedPushOperation {
        protocol_version: PROTOCOL_VERSION,
        operation_id: operation_id.to_string(),
        vault_id: VAULT_ID.to_owned(),
        note_id: note_id.to_string(),
        base_revision: 1,
        ciphertext: vec![9; 16],
        nonce: vec![4; 24],
        aad_version: PROTOCOL_VERSION,
        ciphertext_hash: "a".repeat(64),
        encrypted_vault_key_envelope: None,
    })
    .expect("operation serializes");
    PendingOperation {
        operation_id,
        note_id,
        base_revision: Revision::new(1).expect("valid revision"),
        payload,
        created_at: 1,
    }
}

#[test]
fn pull_network_failure_is_recoverable_and_exposes_pending_state() {
    struct PullOffline;

    impl SyncTransport for PullOffline {
        fn push(&self, operation: EncryptedPushOperation) -> Result<PushAck, TransportError> {
            Ok(PushAck {
                operation_id: operation.operation_id,
            })
        }

        fn pull(&self, _: PullRequest) -> Result<PullOutcome, TransportError> {
            Err(TransportError::Network)
        }
    }

    let mut engine = SyncEngine::new(
        LocalStore::open_in_memory().expect("store opens"),
        PullOffline,
        VAULT_ID,
        RetryPolicy::without_delay(1),
    );

    assert_eq!(
        engine
            .synchronize()
            .expect("network failure is recoverable"),
        SyncState::Pending
    );
}

#[test]
fn concurrent_pull_conflict_preserves_the_local_file_and_exposes_conflict() {
    let store = LocalStore::open_in_memory().expect("store opens");
    let note = IndexedNote {
        note_id: NoteId::new(),
        path: VaultPath::parse("notes/local.md").expect("valid path"),
        content: "local content".to_owned(),
        content_hash: ContentHash::from_bytes(b"local content"),
        revision: Revision::new(1).expect("valid revision"),
        updated_at: 1,
    };
    store.upsert_note(&note).expect("local state persists");
    struct ConflictTransport;
    impl SyncTransport for ConflictTransport {
        fn push(&self, operation: EncryptedPushOperation) -> Result<PushAck, TransportError> {
            Ok(PushAck {
                operation_id: operation.operation_id,
            })
        }

        fn pull(&self, _: PullRequest) -> Result<PullOutcome, TransportError> {
            Ok(PullOutcome::Conflict(Conflict {
                protocol_version: PROTOCOL_VERSION,
                operation_id: OperationId::new().to_string(),
                vault_id: VAULT_ID.to_owned(),
                note_id: NoteId::new().to_string(),
                base_revision: 1,
                remote_revision: 2,
                base_ciphertext_hash: "a".repeat(64),
                local_ciphertext_hash: "b".repeat(64),
                remote_ciphertext_hash: "c".repeat(64),
            }))
        }
    }
    let mut engine = SyncEngine::new(
        store,
        ConflictTransport,
        VAULT_ID,
        RetryPolicy::without_delay(1),
    );

    assert_eq!(
        engine.synchronize().expect("conflict is exposed"),
        SyncState::Conflict
    );
    assert_eq!(
        engine
            .store()
            .note_content(&note.path)
            .expect("local note reads"),
        Some("local content".to_owned())
    );
}

#[test]
fn resnapshot_required_retries_pull_with_a_null_cursor_without_interpreting_it() {
    let store = LocalStore::open_in_memory().expect("store opens");
    let cursor = SyncCursor::new("0198e5de-9999-7aaa-8bbb-ccccddddeeee").expect("valid cursor");
    store
        .set_sync_cursor(VAULT_ID, cursor.as_str())
        .expect("cursor persists");
    let requests = RefCell::new(Vec::new());
    struct ResnapshotTransport<'a> {
        requests: &'a RefCell<Vec<Option<String>>>,
    }
    impl SyncTransport for ResnapshotTransport<'_> {
        fn push(&self, operation: EncryptedPushOperation) -> Result<PushAck, TransportError> {
            Ok(PushAck {
                operation_id: operation.operation_id,
            })
        }

        fn pull(&self, request: PullRequest) -> Result<PullOutcome, TransportError> {
            self.requests
                .borrow_mut()
                .push(request.cursor.map(|cursor| cursor.as_str().to_owned()));
            if self.requests.borrow().len() == 1 {
                Ok(PullOutcome::ResnapshotRequired)
            } else {
                Ok(PullOutcome::Page(PullResponse {
                    protocol_version: PROTOCOL_VERSION,
                    operations: Vec::new(),
                    next_cursor: None,
                }))
            }
        }
    }
    let mut engine = SyncEngine::new(
        store,
        ResnapshotTransport {
            requests: &requests,
        },
        VAULT_ID,
        RetryPolicy::without_delay(1),
    );

    assert_eq!(
        engine.synchronize().expect("resnapshot succeeds"),
        SyncState::Synced
    );
    assert_eq!(
        requests.borrow().as_slice(),
        &[Some(cursor.as_str().to_owned()), None]
    );
    assert_eq!(
        engine.store().sync_cursor(VAULT_ID).expect("cursor reads"),
        None
    );
}
