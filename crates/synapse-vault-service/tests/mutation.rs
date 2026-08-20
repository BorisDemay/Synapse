use synapse_core::{NoteId, Revision, VaultId, VaultPath, VaultService};
use synapse_crypto::{VaultCipher, VaultKey};
use synapse_local_store::LocalStore;
use synapse_vault_service::{VaultMutation, VaultOrchestrator};
use tempfile::tempdir;

#[tokio::test]
async fn mutation_writes_the_file_indexes_it_and_enqueues_only_encrypted_payload() {
    let directory = tempdir().expect("temporary vault");
    let vault = VaultService::open(directory.path())
        .await
        .expect("vault opens");
    let note_id = NoteId::new();
    let mutation = VaultMutation::new(
        note_id.clone(),
        VaultPath::parse("notes/atomic.md").expect("valid path"),
        "# Private note\nSee [[Roadmap]].",
        Revision::new(1).expect("positive revision"),
        Revision::new(1).expect("positive base revision"),
        1,
    );
    let mut orchestrator = VaultOrchestrator::new(
        vault,
        LocalStore::open_in_memory().expect("store opens"),
        VaultId::new(),
        VaultCipher::new(VaultKey::generate()),
    );

    orchestrator
        .mutate(&mutation)
        .await
        .expect("complete local mutation persists");

    assert_eq!(
        std::fs::read_to_string(directory.path().join("notes/atomic.md")).expect("file reads"),
        "# Private note\nSee [[Roadmap]]."
    );
    assert_eq!(
        orchestrator
            .store()
            .note_content(mutation.path())
            .expect("index reads")
            .as_deref(),
        Some("# Private note\nSee [[Roadmap]].")
    );
    assert_eq!(
        orchestrator
            .store()
            .links_for(&note_id)
            .expect("links read"),
        ["Roadmap"]
    );
    assert_eq!(
        orchestrator
            .store()
            .revision_count(&note_id)
            .expect("revisions read"),
        1
    );
    assert_eq!(
        orchestrator
            .store()
            .pending_operation_count()
            .expect("outbox reads"),
        1
    );
    let payload = orchestrator
        .store()
        .pending_operation_payload(mutation.operation_id())
        .expect("outbox reads")
        .expect("outbox entry exists");
    assert!(
        !payload
            .windows(b"# Private note".len())
            .any(|window| window == b"# Private note"),
        "pending operation must not contain plaintext Markdown"
    );
    assert!(
        !payload
            .windows(b"notes/atomic.md".len())
            .any(|window| window == b"notes/atomic.md"),
        "pending operation must not contain the vault path"
    );

    let update = VaultMutation::new(
        note_id.clone(),
        VaultPath::parse("notes/atomic.md").expect("valid path"),
        "# Private note\nUpdated [[Roadmap]].",
        Revision::new(2).expect("positive revision"),
        Revision::new(1).expect("positive base revision"),
        2,
    );
    orchestrator
        .mutate(&update)
        .await
        .expect("existing note can be replaced");
    assert_eq!(
        std::fs::read_to_string(directory.path().join("notes/atomic.md")).expect("file reads"),
        "# Private note\nUpdated [[Roadmap]]."
    );
}
