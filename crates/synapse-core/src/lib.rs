#![forbid(unsafe_code)]

mod ids;
mod path;
mod version;

pub use ids::{ContentHash, NoteId, OperationId, VaultId};
pub use path::VaultPath;
pub use version::Revision;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
