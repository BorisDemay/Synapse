use synapse_core::{ContentHash, NoteId, Revision, VaultPath};
use synapse_local_store::{IndexedNote, LocalStore};

fn indexed_note(path: &str) -> IndexedNote {
    IndexedNote {
        note_id: NoteId::new(),
        path: VaultPath::parse(path).unwrap(),
        content: "# Note".to_owned(),
        content_hash: ContentHash::from_bytes(b"# Note"),
        revision: Revision::new(1).unwrap(),
        updated_at: 1,
    }
}

#[test]
fn rebuilding_a_note_links_preserves_other_notes_backlinks() {
    let mut store = LocalStore::open_in_memory().unwrap();
    let first = indexed_note("notes/first.md");
    let second = indexed_note("notes/second.md");
    store.upsert_note(&first).unwrap();
    store.upsert_note(&second).unwrap();
    store
        .replace_links(&first.note_id, &["Roadmap".to_owned()])
        .unwrap();
    store
        .replace_links(&second.note_id, &["Roadmap".to_owned()])
        .unwrap();

    store
        .replace_links(&first.note_id, &["Architecture".to_owned()])
        .unwrap();

    assert_eq!(
        store.backlink_paths("Roadmap").unwrap(),
        ["notes/second.md"]
    );
}
