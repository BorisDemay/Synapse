#![forbid(unsafe_code)]

mod fs;
mod ids;
mod markdown;
mod path;
mod vault;
mod version;

pub use ids::{ContentHash, NoteId, OperationId, VaultId};
pub use markdown::{NoteParseError, ParsedNote, WikiLink, parse_note, parse_note_bytes};
pub use path::VaultPath;
pub use vault::VaultService;
pub use version::Revision;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
