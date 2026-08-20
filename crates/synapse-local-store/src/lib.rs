#![forbid(unsafe_code)]

use std::error::Error;
use std::fmt;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use synapse_core::{ContentHash, NoteId, OperationId, Revision, VaultPath};

const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_initial.sql");
const REVISION_TAGS_MIGRATION: &str =
    include_str!("../migrations/0002_revision_content_and_tags.sql");

pub struct LocalStore {
    connection: Connection,
}

pub struct IndexedNote {
    pub note_id: NoteId,
    pub path: VaultPath,
    pub content: String,
    pub content_hash: ContentHash,
    pub revision: Revision,
    pub updated_at: i64,
}

pub struct RevisionRecord {
    pub revision: i64,
    pub created_at: i64,
    pub content: String,
}

pub struct PendingOperation {
    pub operation_id: OperationId,
    pub note_id: NoteId,
    pub base_revision: Revision,
    pub payload: Vec<u8>,
    pub created_at: i64,
}

#[derive(Debug)]
pub enum StoreError {
    RevisionOutOfRange,
    Sql(rusqlite::Error),
}

impl fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RevisionOutOfRange => {
                formatter.write_str("revision exceeds SQLite integer range")
            }
            Self::Sql(error) => error.fmt(formatter),
        }
    }
}

impl Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

pub type StoreResult<T> = Result<T, StoreError>;

impl LocalStore {
    pub fn open_in_memory() -> StoreResult<Self> {
        let connection = Connection::open_in_memory()?;
        Self::from_connection(connection)
    }

    pub fn open(path: impl AsRef<Path>) -> StoreResult<Self> {
        let connection = Connection::open(path)?;
        Self::from_connection(connection)
    }

    fn from_connection(mut connection: Connection) -> StoreResult<Self> {
        connection.execute_batch("PRAGMA foreign_keys = ON")?;
        let transaction = connection.transaction()?;
        transaction.execute_batch(INITIAL_MIGRATION)?;
        if !Self::column_exists(&transaction, "revisions", "content")? {
            transaction.execute_batch(
                "ALTER TABLE revisions ADD COLUMN content TEXT NOT NULL DEFAULT ''",
            )?;
        }
        transaction.execute_batch(REVISION_TAGS_MIGRATION)?;
        transaction.commit()?;

        Ok(Self { connection })
    }

    fn column_exists(
        transaction: &rusqlite::Transaction<'_>,
        table: &str,
        column: &str,
    ) -> StoreResult<bool> {
        let mut statement = transaction.prepare(&format!("PRAGMA table_info({table})"))?;
        let names = statement.query_map([], |row| row.get::<_, String>(1))?;
        for name in names {
            if name? == column {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn has_table(&self, table_name: &str) -> StoreResult<bool> {
        self.connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                [table_name],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    pub fn upsert_note(&self, note: &IndexedNote) -> StoreResult<()> {
        let revision =
            i64::try_from(note.revision.get()).map_err(|_| StoreError::RevisionOutOfRange)?;
        self.connection.execute(
            "INSERT INTO notes (note_id, vault_path, content, content_hash, revision, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(vault_path) DO UPDATE SET
                 note_id = excluded.note_id,
                 content = excluded.content,
                 content_hash = excluded.content_hash,
                 revision = excluded.revision,
                 updated_at = excluded.updated_at",
            params![
                note.note_id.to_string(),
                note.path.as_str(),
                note.content,
                note.content_hash.to_string(),
                revision,
                note.updated_at,
            ],
        )?;

        Ok(())
    }

    /// Persists one local index update and its already-encrypted outbox entry in
    /// a single SQLite transaction. The payload is opaque to this storage layer.
    pub fn persist_note_and_operation(
        &mut self,
        note: &IndexedNote,
        links: &[String],
        tags: &[String],
        operation: &PendingOperation,
    ) -> StoreResult<()> {
        let revision =
            i64::try_from(note.revision.get()).map_err(|_| StoreError::RevisionOutOfRange)?;
        let base_revision = i64::try_from(operation.base_revision.get())
            .map_err(|_| StoreError::RevisionOutOfRange)?;
        let transaction = self.connection.transaction()?;

        transaction.execute(
            "INSERT INTO notes (note_id, vault_path, content, content_hash, revision, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(vault_path) DO UPDATE SET
                 note_id = excluded.note_id,
                 content = excluded.content,
                 content_hash = excluded.content_hash,
                 revision = excluded.revision,
                 updated_at = excluded.updated_at",
            params![
                note.note_id.to_string(),
                note.path.as_str(),
                note.content,
                note.content_hash.to_string(),
                revision,
                note.updated_at,
            ],
        )?;
        transaction.execute(
            "INSERT INTO revisions (note_id, revision, content_hash, created_at, content)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(note_id, revision) DO NOTHING",
            params![
                note.note_id.to_string(),
                revision,
                note.content_hash.to_string(),
                note.updated_at,
                note.content,
            ],
        )?;
        transaction.execute(
            "DELETE FROM note_tags WHERE note_id = ?1",
            [note.note_id.to_string()],
        )?;
        for tag in tags {
            transaction.execute(
                "INSERT INTO note_tags (note_id, tag) VALUES (?1, ?2)",
                params![note.note_id.to_string(), tag],
            )?;
        }
        transaction.execute(
            "DELETE FROM links WHERE source_note_id = ?1",
            [note.note_id.to_string()],
        )?;
        for target in links {
            transaction.execute(
                "INSERT INTO links (source_note_id, target) VALUES (?1, ?2)",
                params![note.note_id.to_string(), target],
            )?;
        }
        // The latest local version is the one that must eventually reach the
        // server. Keeping superseded autosave entries would turn a single
        // offline edit into a sequence of stale global revisions. An entry
        // replayed with the same operation id (crash recovery) must survive
        // untouched so its payload stays byte-identical.
        transaction.execute(
            "DELETE FROM pending_operations WHERE note_id = ?1 AND operation_id != ?2",
            params![
                operation.note_id.to_string(),
                operation.operation_id.to_string()
            ],
        )?;
        transaction.execute(
            "INSERT INTO pending_operations (operation_id, note_id, base_revision, payload, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(operation_id) DO NOTHING",
            params![
                operation.operation_id.to_string(),
                operation.note_id.to_string(),
                base_revision,
                operation.payload,
                operation.created_at,
            ],
        )?;
        transaction.commit()?;

        Ok(())
    }

    pub fn note_content(&self, path: &VaultPath) -> StoreResult<Option<String>> {
        self.connection
            .query_row(
                "SELECT content FROM notes WHERE vault_path = ?1",
                [path.as_str()],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn delete_note(&self, path: &VaultPath) -> StoreResult<()> {
        self.connection
            .execute("DELETE FROM notes WHERE vault_path = ?1", [path.as_str()])?;

        Ok(())
    }

    pub fn search_paths(&self, query: &str) -> StoreResult<Vec<String>> {
        self.search_paths_limited(query, usize::MAX)
    }

    pub fn search_paths_limited(&self, query: &str, limit: usize) -> StoreResult<Vec<String>> {
        let query = query
            .split(|character: char| !character.is_alphanumeric())
            .filter(|term| !term.is_empty())
            .map(|term| format!("{term}*"))
            .collect::<Vec<_>>()
            .join(" AND ");
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        let mut statement = self.connection.prepare(
            "SELECT notes.vault_path
             FROM notes_fts
             JOIN notes ON notes.note_id = notes_fts.note_id
             WHERE notes_fts MATCH ?1
             ORDER BY notes.vault_path
             LIMIT ?2",
        )?;
        let paths = statement
            .query_map(params![query, limit], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(paths)
    }

    pub fn enqueue_operation(&self, operation: &PendingOperation) -> StoreResult<()> {
        let base_revision = i64::try_from(operation.base_revision.get())
            .map_err(|_| StoreError::RevisionOutOfRange)?;
        self.connection.execute(
            "INSERT INTO pending_operations (operation_id, note_id, base_revision, payload, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                operation.operation_id.to_string(),
                operation.note_id.to_string(),
                base_revision,
                operation.payload,
                operation.created_at,
            ],
        )?;

        Ok(())
    }

    pub fn pending_operation_count(&self) -> StoreResult<i64> {
        self.connection
            .query_row("SELECT COUNT(*) FROM pending_operations", [], |row| {
                row.get(0)
            })
            .map_err(Into::into)
    }

    pub fn pending_operation_payload(
        &self,
        operation_id: &OperationId,
    ) -> StoreResult<Option<Vec<u8>>> {
        self.connection
            .query_row(
                "SELECT payload FROM pending_operations WHERE operation_id = ?1",
                [operation_id.to_string()],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }

    /// Returns queued opaque payloads in stable creation order. Payloads stay
    /// unparsed at the local storage boundary.
    pub fn pending_operation_payloads(&self) -> StoreResult<Vec<Vec<u8>>> {
        let mut statement = self
            .connection
            .prepare("SELECT payload FROM pending_operations ORDER BY created_at, operation_id")?;
        statement
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    /// Retains the latest unsent edit per note. This is safe because every
    /// retained entry is still pending and the local index already represents
    /// the latest version of that note.
    pub fn retain_latest_pending_operation_per_note(&self) -> StoreResult<()> {
        self.connection.execute(
            "DELETE FROM pending_operations AS current
             WHERE EXISTS (
                SELECT 1
                FROM pending_operations AS newer
                WHERE newer.note_id = current.note_id
                  AND (
                    newer.created_at > current.created_at
                    OR (
                        newer.created_at = current.created_at
                        AND newer.operation_id > current.operation_id
                    )
                  )
             )",
            [],
        )?;
        Ok(())
    }

    /// Replaces a pending operation after a client-side rebase. The old
    /// operation was conclusively rejected by the server, so a fresh operation
    /// identifier is required for the rebased ciphertext.
    pub fn replace_pending_operation(
        &mut self,
        replaced_operation_id: &str,
        operation: &PendingOperation,
    ) -> StoreResult<()> {
        let base_revision = i64::try_from(operation.base_revision.get())
            .map_err(|_| StoreError::RevisionOutOfRange)?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "DELETE FROM pending_operations WHERE operation_id = ?1",
            [replaced_operation_id],
        )?;
        transaction.execute(
            "INSERT INTO pending_operations (operation_id, note_id, base_revision, payload, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                operation.operation_id.to_string(),
                operation.note_id.to_string(),
                base_revision,
                operation.payload,
                operation.created_at,
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn acknowledge_operation(&self, operation_id: &OperationId) -> StoreResult<()> {
        self.acknowledge_operation_id(&operation_id.to_string())
    }

    /// Deletes only the exact operation identifier explicitly acknowledged by
    /// the server. The payload remains opaque to this storage boundary.
    pub fn acknowledge_operation_id(&self, operation_id: &str) -> StoreResult<()> {
        self.connection.execute(
            "DELETE FROM pending_operations WHERE operation_id = ?1",
            [operation_id],
        )?;

        Ok(())
    }

    pub fn set_sync_cursor(&self, vault_id: &str, cursor: &str) -> StoreResult<()> {
        self.connection.execute(
            "INSERT INTO sync_cursors (vault_id, cursor) VALUES (?1, ?2)
             ON CONFLICT(vault_id) DO UPDATE SET cursor = excluded.cursor",
            params![vault_id, cursor],
        )?;

        Ok(())
    }

    pub fn sync_cursor(&self, vault_id: &str) -> StoreResult<Option<String>> {
        self.connection
            .query_row(
                "SELECT cursor FROM sync_cursors WHERE vault_id = ?1",
                [vault_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn clear_sync_cursor(&self, vault_id: &str) -> StoreResult<()> {
        self.connection
            .execute("DELETE FROM sync_cursors WHERE vault_id = ?1", [vault_id])?;

        Ok(())
    }

    pub fn record_revision(&self, note: &IndexedNote) -> StoreResult<()> {
        let revision =
            i64::try_from(note.revision.get()).map_err(|_| StoreError::RevisionOutOfRange)?;
        self.connection.execute(
            "INSERT INTO revisions (note_id, revision, content_hash, created_at, content)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                note.note_id.to_string(),
                revision,
                note.content_hash.to_string(),
                note.updated_at,
                note.content,
            ],
        )?;

        Ok(())
    }

    pub fn revision_count(&self, note_id: &NoteId) -> StoreResult<i64> {
        self.connection
            .query_row(
                "SELECT COUNT(*) FROM revisions WHERE note_id = ?1",
                [note_id.to_string()],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    pub fn replace_links(&mut self, note_id: &NoteId, targets: &[String]) -> StoreResult<()> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "DELETE FROM links WHERE source_note_id = ?1",
            [note_id.to_string()],
        )?;
        for target in targets {
            transaction.execute(
                "INSERT INTO links (source_note_id, target) VALUES (?1, ?2)",
                params![note_id.to_string(), target],
            )?;
        }
        transaction.commit()?;

        Ok(())
    }

    pub fn links_for(&self, note_id: &NoteId) -> StoreResult<Vec<String>> {
        let mut statement = self
            .connection
            .prepare("SELECT target FROM links WHERE source_note_id = ?1 ORDER BY target")?;
        let links = statement
            .query_map([note_id.to_string()], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(links)
    }

    pub fn path_for_note_id(&self, note_id: &NoteId) -> StoreResult<Option<String>> {
        self.connection
            .query_row(
                "SELECT vault_path FROM notes WHERE note_id = ?1",
                [note_id.to_string()],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn note_id_for_path(&self, path: &VaultPath) -> StoreResult<Option<String>> {
        self.connection
            .query_row(
                "SELECT note_id FROM notes WHERE vault_path = ?1",
                [path.as_str()],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn revision_for_path(&self, path: &VaultPath) -> StoreResult<Option<i64>> {
        self.connection
            .query_row(
                "SELECT revision FROM notes WHERE vault_path = ?1",
                [path.as_str()],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn put_kv(&self, key: &str, value: &[u8]) -> StoreResult<()> {
        self.connection.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_kv(&self, key: &str) -> StoreResult<Option<Vec<u8>>> {
        self.connection
            .query_row("SELECT value FROM kv WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(Into::into)
    }

    pub fn delete_kv(&self, key: &str) -> StoreResult<()> {
        self.connection
            .execute("DELETE FROM kv WHERE key = ?1", [key])?;
        Ok(())
    }

    pub fn backlink_paths(&self, target: &str) -> StoreResult<Vec<String>> {
        let mut statement = self.connection.prepare(
            "SELECT notes.vault_path
             FROM links
             JOIN notes ON notes.note_id = links.source_note_id
             WHERE links.target = ?1
             ORDER BY notes.vault_path",
        )?;
        let paths = statement
            .query_map([target], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(paths)
    }

    pub fn list_revisions(&self, note_id: &NoteId) -> StoreResult<Vec<RevisionRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT revision, created_at, content FROM revisions
             WHERE note_id = ?1
             ORDER BY revision DESC",
        )?;
        let rows = statement.query_map([note_id.to_string()], |row| {
            Ok(RevisionRecord {
                revision: row.get(0)?,
                created_at: row.get(1)?,
                content: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn pending_note_ids(&self) -> StoreResult<Vec<String>> {
        let mut statement = self
            .connection
            .prepare("SELECT DISTINCT note_id FROM pending_operations")?;
        let ids = statement
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ids)
    }

    pub fn tags_for_note(&self, note_id: &NoteId) -> StoreResult<Vec<String>> {
        let mut statement = self
            .connection
            .prepare("SELECT tag FROM note_tags WHERE note_id = ?1 ORDER BY tag")?;
        let tags = statement
            .query_map([note_id.to_string()], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tags)
    }

    pub fn notes_with_tag(&self, tag: &str) -> StoreResult<Vec<String>> {
        let mut statement = self.connection.prepare(
            "SELECT notes.vault_path
             FROM note_tags
             JOIN notes ON notes.note_id = note_tags.note_id
             WHERE note_tags.tag = ?1
             ORDER BY notes.vault_path",
        )?;
        let paths = statement
            .query_map([tag], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(paths)
    }

    pub fn replace_tags(&self, note_id: &NoteId, tags: &[String]) -> StoreResult<()> {
        self.connection.execute(
            "DELETE FROM note_tags WHERE note_id = ?1",
            [note_id.to_string()],
        )?;
        for tag in tags {
            self.connection.execute(
                "INSERT INTO note_tags (note_id, tag) VALUES (?1, ?2)",
                params![note_id.to_string(), tag],
            )?;
        }
        Ok(())
    }
}
