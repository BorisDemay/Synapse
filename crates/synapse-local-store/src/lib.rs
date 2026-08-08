#![forbid(unsafe_code)]

use std::error::Error;
use std::fmt;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use synapse_core::{ContentHash, NoteId, OperationId, Revision, VaultPath};

const INITIAL_MIGRATION: &str = include_str!("../migrations/0001_initial.sql");

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
        transaction.commit()?;

        Ok(Self { connection })
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

    pub fn acknowledge_operation(&self, operation_id: &OperationId) -> StoreResult<()> {
        self.connection.execute(
            "DELETE FROM pending_operations WHERE operation_id = ?1",
            [operation_id.to_string()],
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

    pub fn record_revision(&self, note: &IndexedNote) -> StoreResult<()> {
        let revision =
            i64::try_from(note.revision.get()).map_err(|_| StoreError::RevisionOutOfRange)?;
        self.connection.execute(
            "INSERT INTO revisions (note_id, revision, content_hash, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                note.note_id.to_string(),
                revision,
                note.content_hash.to_string(),
                note.updated_at,
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
}
