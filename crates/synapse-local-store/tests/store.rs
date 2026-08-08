use synapse_core::{ContentHash, NoteId, OperationId, Revision, VaultPath};
use synapse_local_store::{IndexedNote, LocalStore, PendingOperation};
use tempfile::tempdir;

#[test]
fn migration_creates_operation_queue() {
    let store = LocalStore::open_in_memory().unwrap();

    assert!(store.has_table("pending_operations").unwrap());
}

#[test]
fn migration_creates_local_index_tables() {
    let store = LocalStore::open_in_memory().unwrap();

    for table in ["notes", "links", "revisions", "sync_cursors", "notes_fts"] {
        assert!(store.has_table(table).unwrap(), "missing table {table}");
    }
}

#[test]
fn upsert_note_persists_markdown_by_vault_path() {
    let store = LocalStore::open_in_memory().unwrap();
    let path = VaultPath::parse("notes/hello.md").unwrap();
    let note = IndexedNote {
        note_id: NoteId::new(),
        path: path.clone(),
        content: "# Hello".to_owned(),
        content_hash: ContentHash::from_bytes(b"# Hello"),
        revision: Revision::new(1).unwrap(),
        updated_at: 1,
    };

    store.upsert_note(&note).unwrap();

    assert_eq!(
        store.note_content(&path).unwrap().as_deref(),
        Some("# Hello")
    );
}

#[test]
fn delete_note_removes_markdown_from_the_index() {
    let store = LocalStore::open_in_memory().unwrap();
    let path = VaultPath::parse("notes/hello.md").unwrap();
    let note = IndexedNote {
        note_id: NoteId::new(),
        path: path.clone(),
        content: "# Hello".to_owned(),
        content_hash: ContentHash::from_bytes(b"# Hello"),
        revision: Revision::new(1).unwrap(),
        updated_at: 1,
    };
    store.upsert_note(&note).unwrap();

    store.delete_note(&path).unwrap();

    assert_eq!(store.note_content(&path).unwrap(), None);
}

#[test]
fn search_returns_matching_note_paths() {
    let store = LocalStore::open_in_memory().unwrap();
    let path = VaultPath::parse("notes/hello.md").unwrap();
    let note = IndexedNote {
        note_id: NoteId::new(),
        path,
        content: "# Hello Synapse".to_owned(),
        content_hash: ContentHash::from_bytes(b"# Hello Synapse"),
        revision: Revision::new(1).unwrap(),
        updated_at: 1,
    };
    store.upsert_note(&note).unwrap();

    assert_eq!(store.search_paths("Synapse").unwrap(), ["notes/hello.md"]);
}

#[test]
fn enqueue_operation_persists_it_until_acknowledged() {
    let store = LocalStore::open_in_memory().unwrap();
    let operation = PendingOperation {
        operation_id: OperationId::new(),
        note_id: NoteId::new(),
        base_revision: Revision::new(1).unwrap(),
        payload: b"ciphertext".to_vec(),
        created_at: 1,
    };

    store.enqueue_operation(&operation).unwrap();

    assert_eq!(store.pending_operation_count().unwrap(), 1);
}

#[test]
fn acknowledge_operation_removes_it_from_the_queue() {
    let store = LocalStore::open_in_memory().unwrap();
    let operation = PendingOperation {
        operation_id: OperationId::new(),
        note_id: NoteId::new(),
        base_revision: Revision::new(1).unwrap(),
        payload: b"ciphertext".to_vec(),
        created_at: 1,
    };
    store.enqueue_operation(&operation).unwrap();

    store
        .acknowledge_operation(&operation.operation_id)
        .unwrap();

    assert_eq!(store.pending_operation_count().unwrap(), 0);
}

#[test]
fn pending_operations_survive_reopening_the_database() {
    let directory = tempdir().unwrap();
    let database_path = directory.path().join("index.sqlite");
    let operation = PendingOperation {
        operation_id: OperationId::new(),
        note_id: NoteId::new(),
        base_revision: Revision::new(1).unwrap(),
        payload: b"ciphertext".to_vec(),
        created_at: 1,
    };

    let store = LocalStore::open(&database_path).unwrap();
    store.enqueue_operation(&operation).unwrap();
    drop(store);

    let reopened = LocalStore::open(&database_path).unwrap();

    assert_eq!(reopened.pending_operation_count().unwrap(), 1);
}

#[test]
fn sync_cursor_is_replaced_for_a_vault() {
    let store = LocalStore::open_in_memory().unwrap();

    store.set_sync_cursor("vault-1", "cursor-1").unwrap();
    store.set_sync_cursor("vault-1", "cursor-2").unwrap();

    assert_eq!(
        store.sync_cursor("vault-1").unwrap().as_deref(),
        Some("cursor-2")
    );
}

#[test]
fn record_revision_preserves_a_note_version() {
    let store = LocalStore::open_in_memory().unwrap();
    let note = IndexedNote {
        note_id: NoteId::new(),
        path: VaultPath::parse("notes/history.md").unwrap(),
        content: "# History".to_owned(),
        content_hash: ContentHash::from_bytes(b"# History"),
        revision: Revision::new(1).unwrap(),
        updated_at: 1,
    };
    store.upsert_note(&note).unwrap();

    store.record_revision(&note).unwrap();

    assert_eq!(store.revision_count(&note.note_id).unwrap(), 1);
}

#[test]
fn replace_links_updates_a_note_relationships() {
    let mut store = LocalStore::open_in_memory().unwrap();
    let note = IndexedNote {
        note_id: NoteId::new(),
        path: VaultPath::parse("notes/links.md").unwrap(),
        content: "# Links".to_owned(),
        content_hash: ContentHash::from_bytes(b"# Links"),
        revision: Revision::new(1).unwrap(),
        updated_at: 1,
    };
    store.upsert_note(&note).unwrap();

    store
        .replace_links(
            &note.note_id,
            &["Roadmap".to_owned(), "Architecture".to_owned()],
        )
        .unwrap();

    assert_eq!(
        store.links_for(&note.note_id).unwrap(),
        ["Architecture", "Roadmap"]
    );
}

#[test]
fn replace_links_rolls_back_when_an_insert_fails() {
    let mut store = LocalStore::open_in_memory().unwrap();
    let note = IndexedNote {
        note_id: NoteId::new(),
        path: VaultPath::parse("notes/rollback.md").unwrap(),
        content: "# Rollback".to_owned(),
        content_hash: ContentHash::from_bytes(b"# Rollback"),
        revision: Revision::new(1).unwrap(),
        updated_at: 1,
    };
    store.upsert_note(&note).unwrap();
    store
        .replace_links(&note.note_id, &["Original".to_owned()])
        .unwrap();

    assert!(
        store
            .replace_links(
                &note.note_id,
                &["Duplicate".to_owned(), "Duplicate".to_owned()],
            )
            .is_err()
    );

    assert_eq!(store.links_for(&note.note_id).unwrap(), ["Original"]);
}

#[test]
fn deleting_a_note_cascades_to_its_revisions() {
    let store = LocalStore::open_in_memory().unwrap();
    let note = IndexedNote {
        note_id: NoteId::new(),
        path: VaultPath::parse("notes/cascade.md").unwrap(),
        content: "# Cascade".to_owned(),
        content_hash: ContentHash::from_bytes(b"# Cascade"),
        revision: Revision::new(1).unwrap(),
        updated_at: 1,
    };
    store.upsert_note(&note).unwrap();
    store.record_revision(&note).unwrap();

    store.delete_note(&note.path).unwrap();

    assert_eq!(store.revision_count(&note.note_id).unwrap(), 0);
}
