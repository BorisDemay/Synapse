use synapse_core::{ContentHash, NoteId, OperationId, Revision, VaultPath};
use synapse_local_store::{IndexedNote, LocalStore, PendingOperation};

fn indexed_note(note_id: NoteId, path: &str, content: &str, revision: u64) -> IndexedNote {
    IndexedNote {
        note_id,
        path: VaultPath::parse(path).expect("valid test path"),
        content: content.to_owned(),
        content_hash: ContentHash::from_bytes(content.as_bytes()),
        revision: Revision::new(revision).expect("positive revision"),
        updated_at: 1,
    }
}

fn pending_operation(note_id: NoteId, base_revision: u64) -> PendingOperation {
    PendingOperation {
        operation_id: OperationId::new(),
        note_id,
        base_revision: Revision::new(base_revision).expect("positive base revision"),
        payload: vec![0x91, 0x82, 0xa3],
        created_at: 1,
    }
}

#[test]
fn persist_note_and_operation_commits_index_revision_links_and_opaque_outbox_together() {
    let mut store = LocalStore::open_in_memory().expect("store opens");
    let note_id = NoteId::new();
    let note = indexed_note(
        note_id.clone(),
        "notes/atomic.md",
        "# Atomic\n[[Roadmap]]",
        1,
    );
    let operation = pending_operation(note_id.clone(), 1);

    store
        .persist_note_and_operation(&note, &["Roadmap".to_owned()], &operation)
        .expect("single SQLite transaction commits");

    assert_eq!(
        store
            .note_content(&note.path)
            .expect("index reads")
            .as_deref(),
        Some("# Atomic\n[[Roadmap]]")
    );
    assert_eq!(store.revision_count(&note_id).expect("revision reads"), 1);
    assert_eq!(store.links_for(&note_id).expect("link reads"), ["Roadmap"]);
    assert_eq!(store.pending_operation_count().expect("outbox reads"), 1);
}

#[test]
fn persist_note_and_operation_rolls_back_every_table_when_link_insert_fails() {
    let mut store = LocalStore::open_in_memory().expect("store opens");
    let note_id = NoteId::new();
    let original = indexed_note(note_id.clone(), "notes/rollback.md", "# Original", 1);
    let original_operation = pending_operation(note_id.clone(), 1);
    store
        .persist_note_and_operation(&original, &["Original".to_owned()], &original_operation)
        .expect("original state persists");

    let replacement = indexed_note(note_id.clone(), "notes/rollback.md", "# Replacement", 2);
    let replacement_operation = pending_operation(note_id.clone(), 2);

    assert!(
        store
            .persist_note_and_operation(
                &replacement,
                &["Duplicate".to_owned(), "Duplicate".to_owned()],
                &replacement_operation,
            )
            .is_err()
    );

    assert_eq!(
        store
            .note_content(&original.path)
            .expect("index reads")
            .as_deref(),
        Some("# Original")
    );
    assert_eq!(store.revision_count(&note_id).expect("revision reads"), 1);
    assert_eq!(store.links_for(&note_id).expect("link reads"), ["Original"]);
    assert_eq!(store.pending_operation_count().expect("outbox reads"), 1);
}
