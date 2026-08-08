CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id TEXT PRIMARY KEY NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
    note_id TEXT PRIMARY KEY NOT NULL,
    vault_path TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
    source_note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
    target TEXT NOT NULL,
    PRIMARY KEY (source_note_id, target)
);

CREATE TABLE IF NOT EXISTS revisions (
    note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision > 0),
    content_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (note_id, revision)
);

CREATE TABLE IF NOT EXISTS pending_operations (
    operation_id TEXT PRIMARY KEY NOT NULL,
    note_id TEXT NOT NULL,
    base_revision INTEGER NOT NULL CHECK (base_revision > 0),
    payload BLOB NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_cursors (
    vault_id TEXT PRIMARY KEY NOT NULL,
    cursor TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    note_id UNINDEXED,
    content
);

CREATE TRIGGER IF NOT EXISTS notes_fts_after_insert
AFTER INSERT ON notes
BEGIN
    INSERT INTO notes_fts (note_id, content) VALUES (new.note_id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_after_update
AFTER UPDATE OF note_id, content ON notes
BEGIN
    DELETE FROM notes_fts WHERE note_id = old.note_id;
    INSERT INTO notes_fts (note_id, content) VALUES (new.note_id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_after_delete
AFTER DELETE ON notes
BEGIN
    DELETE FROM notes_fts WHERE note_id = old.note_id;
END;

INSERT OR IGNORE INTO schema_migrations (migration_id) VALUES ('0001_initial');
