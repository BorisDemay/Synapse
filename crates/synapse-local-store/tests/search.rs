use synapse_core::{ContentHash, NoteId, Revision, VaultPath};
use synapse_local_store::{IndexedNote, LocalStore};

#[test]
fn search_matches_a_prefix() {
    let store = LocalStore::open_in_memory().unwrap();
    let note = IndexedNote {
        note_id: NoteId::new(),
        path: VaultPath::parse("notes/synapse.md").unwrap(),
        content: "# Synapse local-first".to_owned(),
        content_hash: ContentHash::from_bytes(b"# Synapse local-first"),
        revision: Revision::new(1).unwrap(),
        updated_at: 1,
    };
    store.upsert_note(&note).unwrap();

    assert_eq!(store.search_paths("synap").unwrap(), ["notes/synapse.md"]);
}

#[test]
fn search_limits_the_number_of_results() {
    let store = LocalStore::open_in_memory().unwrap();
    for path in ["notes/first.md", "notes/second.md"] {
        let note = IndexedNote {
            note_id: NoteId::new(),
            path: VaultPath::parse(path).unwrap(),
            content: "Synapse".to_owned(),
            content_hash: ContentHash::from_bytes(b"Synapse"),
            revision: Revision::new(1).unwrap(),
            updated_at: 1,
        };
        store.upsert_note(&note).unwrap();
    }

    assert_eq!(
        store.search_paths_limited("synapse", 1).unwrap(),
        ["notes/first.md"]
    );
}

#[test]
fn search_matches_terms_without_accents() {
    let store = LocalStore::open_in_memory().unwrap();
    let note = IndexedNote {
        note_id: NoteId::new(),
        path: VaultPath::parse("notes/cafe.md").unwrap(),
        content: "Café local".to_owned(),
        content_hash: ContentHash::from_bytes("Café local".as_bytes()),
        revision: Revision::new(1).unwrap(),
        updated_at: 1,
    };
    store.upsert_note(&note).unwrap();

    assert_eq!(store.search_paths("cafe").unwrap(), ["notes/cafe.md"]);
}

#[test]
fn search_excludes_a_deleted_note() {
    let store = LocalStore::open_in_memory().unwrap();
    let path = VaultPath::parse("notes/deleted.md").unwrap();
    let note = IndexedNote {
        note_id: NoteId::new(),
        path: path.clone(),
        content: "Synapse supprimé".to_owned(),
        content_hash: ContentHash::from_bytes("Synapse supprimé".as_bytes()),
        revision: Revision::new(1).unwrap(),
        updated_at: 1,
    };
    store.upsert_note(&note).unwrap();
    store.delete_note(&path).unwrap();

    assert!(store.search_paths("synapse").unwrap().is_empty());
}

#[test]
fn search_ignores_a_query_without_search_terms() {
    let store = LocalStore::open_in_memory().unwrap();

    assert!(store.search_paths("---").unwrap().is_empty());
}
