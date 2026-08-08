use std::error::Error;
use std::fmt;

use crate::{ContentHash, Revision};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoryEntry {
    pub revision: Revision,
    pub content: String,
    pub content_hash: ContentHash,
    pub recorded_at: i64,
    pub author: String,
}

#[derive(Default)]
pub struct NoteHistory {
    entries: Vec<HistoryEntry>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HistoryError {
    RevisionAlreadyExists,
    RevisionNotNewer,
    RevisionNotFound,
}

impl fmt::Display for HistoryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RevisionAlreadyExists => formatter.write_str("history revision already exists"),
            Self::RevisionNotNewer => formatter.write_str("history revision must increase"),
            Self::RevisionNotFound => formatter.write_str("history revision was not found"),
        }
    }
}

impl Error for HistoryError {}

impl NoteHistory {
    pub fn entries(&self) -> &[HistoryEntry] {
        &self.entries
    }

    pub fn record(
        &mut self,
        revision: Revision,
        content: impl Into<String>,
        recorded_at: i64,
        author: impl Into<String>,
    ) -> Result<&HistoryEntry, HistoryError> {
        if self.entries.iter().any(|entry| entry.revision == revision) {
            return Err(HistoryError::RevisionAlreadyExists);
        }
        if self
            .entries
            .last()
            .is_some_and(|entry| revision <= entry.revision)
        {
            return Err(HistoryError::RevisionNotNewer);
        }

        let content = content.into();
        self.entries.push(HistoryEntry {
            revision,
            content_hash: ContentHash::from_bytes(content.as_bytes()),
            content,
            recorded_at,
            author: author.into(),
        });

        Ok(self
            .entries
            .last()
            .expect("history entry was just inserted"))
    }

    pub fn restore(
        &mut self,
        source_revision: Revision,
        restored_revision: Revision,
        recorded_at: i64,
        author: impl Into<String>,
    ) -> Result<&HistoryEntry, HistoryError> {
        let content = self
            .entries
            .iter()
            .find(|entry| entry.revision == source_revision)
            .ok_or(HistoryError::RevisionNotFound)?
            .content
            .clone();

        self.record(restored_revision, content, recorded_at, author)
    }
}
