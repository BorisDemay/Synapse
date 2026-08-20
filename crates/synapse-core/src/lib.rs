#![forbid(unsafe_code)]

mod fs;
mod history;
mod ids;
mod item;
mod markdown;
mod path;
mod vault;
mod version;
mod watcher;

pub use history::{HistoryEntry, HistoryError, NoteHistory};
pub use ids::{ContentHash, NoteId, OperationId, VaultId};
pub use item::{
    DecodedVaultItem, ITEM_MAGIC, MAX_ITEM_BYTES, VaultItem, VaultItemError, decode_vault_item,
    decoded_note_markdown, encode_note_plaintext, legacy_web_note_path,
};
pub use markdown::{NoteParseError, ParsedNote, WikiLink, parse_note, parse_note_bytes};
pub use path::{VaultAssetPath, VaultPath, VaultPathError};
pub use vault::{VaultError, VaultService};
pub use version::Revision;
pub use watcher::{VaultChange, VaultWatchError, VaultWatcher};

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
