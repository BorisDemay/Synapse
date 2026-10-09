use synapse_core::{NoteHistory, Revision};

#[test]
fn restoring_a_revision_creates_a_new_revision_without_overwriting_history() {
    let mut history = NoteHistory::default();
    history
        .record(Revision::new(1).unwrap(), "# Première", 10, "alice")
        .unwrap();
    history
        .record(Revision::new(2).unwrap(), "# Deuxième", 20, "alice")
        .unwrap();

    let restored = history
        .restore(
            Revision::new(1).unwrap(),
            Revision::new(3).unwrap(),
            30,
            "alice",
        )
        .unwrap();

    assert_eq!(restored.revision, Revision::new(3).unwrap());
    assert_eq!(restored.content, "# Première");
    assert_eq!(restored.author, "alice");
    assert_eq!(history.entries().len(), 3);
    assert_eq!(history.entries()[1].content, "# Deuxième");
}
