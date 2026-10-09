CREATE TABLE IF NOT EXISTS note_tags (
    note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (note_id, tag)
);

INSERT OR IGNORE INTO schema_migrations (migration_id) VALUES ('0002_revision_content_and_tags');
