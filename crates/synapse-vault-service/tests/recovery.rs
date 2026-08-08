use synapse_core::{NoteId, Revision, VaultId, VaultPath, VaultService};
use synapse_crypto::{VaultCipher, VaultKey};
use synapse_local_store::LocalStore;
use synapse_vault_service::{VaultMutation, VaultOrchestrator};
use tempfile::tempdir;

#[tokio::test]
async fn recovery_after_filesystem_rename_indexes_and_enqueues_the_same_operation_once() {
    let directory = tempdir().expect("temporary vault");
    let database_path = directory.path().join("index.sqlite");
    let note_id = NoteId::new();
    let mutation = VaultMutation::new(
        note_id.clone(),
        VaultPath::parse("notes/recovered.md").expect("valid path"),
        "# Recovered\nSee [[Roadmap]].",
        Revision::new(1).expect("positive revision"),
        Revision::new(1).expect("positive base revision"),
        1,
    );

    let vault = VaultService::open(directory.path())
        .await
        .expect("vault opens");
    vault
        .create_note(mutation.path(), "# Recovered\nSee [[Roadmap]].")
        .await
        .expect("filesystem rename completes before simulated crash");
    drop(vault);

    let vault = VaultService::open(directory.path())
        .await
        .expect("vault reopens after crash");
    let mut orchestrator = VaultOrchestrator::new(
        vault,
        LocalStore::open(&database_path).expect("store opens after crash"),
        VaultId::new(),
        VaultCipher::new(VaultKey::generate()),
    );

    orchestrator
        .recover_mutation(&mutation)
        .await
        .expect("reconciler repairs the missing SQLite transaction");
    let first_payload = orchestrator
        .store()
        .pending_operation_payload(mutation.operation_id())
        .expect("outbox reads")
        .expect("outbox entry exists");

    orchestrator
        .recover_mutation(&mutation)
        .await
        .expect("same recovery is idempotent");

    assert_eq!(
        orchestrator
            .store()
            .note_content(mutation.path())
            .expect("index reads")
            .as_deref(),
        Some("# Recovered\nSee [[Roadmap]].")
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
            .links_for(&note_id)
            .expect("links read"),
        ["Roadmap"]
    );
    assert_eq!(
        orchestrator
            .store()
            .pending_operation_count()
            .expect("outbox reads"),
        1
    );
    assert_eq!(
        orchestrator
            .store()
            .pending_operation_payload(mutation.operation_id())
            .expect("outbox reads"),
        Some(first_payload)
    );
}
