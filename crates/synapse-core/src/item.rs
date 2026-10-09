use std::error::Error;
use std::fmt;

use crate::path::{VaultAssetPath, VaultPath, VaultPathError};

pub const ITEM_MAGIC: &str = "SYNAPSE-ITEM-v1";
pub const MAX_ITEM_BYTES: usize = 10 * 1024 * 1024;
const MAX_CONTENT_TYPE_BYTES: usize = 128;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VaultItem {
    Note {
        path: VaultPath,
        markdown: String,
    },
    Attachment {
        path: VaultAssetPath,
        content_type: String,
        bytes: Vec<u8>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DecodedVaultItem {
    LegacyNote { markdown: String },
    Item(VaultItem),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VaultItemError {
    ContentTypeInvalid,
    ItemTooLarge,
    Malformed,
    MissingBody,
    Path(VaultPathError),
    UnknownKind,
}

impl fmt::Display for VaultItemError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ContentTypeInvalid => formatter.write_str("item content type is invalid"),
            Self::ItemTooLarge => formatter.write_str("vault item exceeds the maximum size"),
            Self::Malformed => formatter.write_str("vault item is malformed"),
            Self::MissingBody => formatter.write_str("vault item is missing a body"),
            Self::Path(error) => error.fmt(formatter),
            Self::UnknownKind => formatter.write_str("vault item kind is unknown"),
        }
    }
}

impl Error for VaultItemError {}

impl From<VaultPathError> for VaultItemError {
    fn from(error: VaultPathError) -> Self {
        Self::Path(error)
    }
}

impl VaultItem {
    pub fn encode(&self) -> Result<Vec<u8>, VaultItemError> {
        let encoded = match self {
            Self::Note { path, markdown } => {
                let mut encoded = header("note", path.as_str(), None);
                encoded.extend_from_slice(markdown.as_bytes());
                encoded
            }
            Self::Attachment {
                path,
                content_type,
                bytes,
            } => {
                validate_content_type(content_type)?;
                let mut encoded = header("attachment", path.as_str(), Some(content_type));
                encoded.extend_from_slice(bytes);
                encoded
            }
        };
        if encoded.len() > MAX_ITEM_BYTES {
            return Err(VaultItemError::ItemTooLarge);
        }
        Ok(encoded)
    }

    pub fn note_markdown(&self) -> Option<&str> {
        match self {
            Self::Note { markdown, .. } => Some(markdown),
            Self::Attachment { .. } => None,
        }
    }
}

pub fn encode_note_plaintext(path: &VaultPath, markdown: &str) -> Result<Vec<u8>, VaultItemError> {
    VaultItem::Note {
        path: path.clone(),
        markdown: markdown.to_owned(),
    }
    .encode()
}

pub fn decoded_note_markdown(decoded: &DecodedVaultItem) -> Option<&str> {
    match decoded {
        DecodedVaultItem::LegacyNote { markdown } => Some(markdown),
        DecodedVaultItem::Item(item) => item.note_markdown(),
    }
}

pub fn decode_vault_item(bytes: &[u8]) -> Result<DecodedVaultItem, VaultItemError> {
    if bytes.len() > MAX_ITEM_BYTES {
        return Err(VaultItemError::ItemTooLarge);
    }
    let magic_prefix = format!("{ITEM_MAGIC}\n");
    let Some(rest) = bytes.strip_prefix(magic_prefix.as_bytes()) else {
        let markdown = std::str::from_utf8(bytes).map_err(|_| VaultItemError::Malformed)?;
        return Ok(DecodedVaultItem::LegacyNote {
            markdown: markdown.to_owned(),
        });
    };

    let Some(header_end) = find_header_end(rest) else {
        return Err(VaultItemError::MissingBody);
    };
    let header = std::str::from_utf8(&rest[..header_end]).map_err(|_| VaultItemError::Malformed)?;
    let body = rest
        .get(header_end + 2..)
        .ok_or(VaultItemError::MissingBody)?;

    let mut kind = None;
    let mut path = None;
    let mut content_type = None;
    for line in header.lines() {
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once(": ") else {
            return Err(VaultItemError::Malformed);
        };
        match key {
            "kind" => kind = Some(value),
            "path" => path = Some(value),
            "content-type" => content_type = Some(value),
            _ => return Err(VaultItemError::Malformed),
        }
    }
    let path = path.ok_or(VaultItemError::Malformed)?;
    match kind.ok_or(VaultItemError::Malformed)? {
        "note" => {
            let markdown = std::str::from_utf8(body).map_err(|_| VaultItemError::Malformed)?;
            Ok(DecodedVaultItem::Item(VaultItem::Note {
                path: VaultPath::parse(path)?,
                markdown: markdown.to_owned(),
            }))
        }
        "attachment" => {
            let content_type = content_type.unwrap_or("application/octet-stream");
            validate_content_type(content_type)?;
            Ok(DecodedVaultItem::Item(VaultItem::Attachment {
                path: VaultAssetPath::parse(path)?,
                content_type: content_type.to_owned(),
                bytes: body.to_vec(),
            }))
        }
        _ => Err(VaultItemError::UnknownKind),
    }
}

pub fn legacy_web_note_path(note_id: &str) -> Result<VaultPath, VaultPathError> {
    let short = note_id.get(..8).unwrap_or(note_id);
    VaultPath::parse(&format!("notes/{short}.md"))
}

fn header(kind: &str, path: &str, content_type: Option<&str>) -> Vec<u8> {
    let mut header = format!("{ITEM_MAGIC}\nkind: {kind}\npath: {path}\n");
    if let Some(content_type) = content_type {
        header.push_str("content-type: ");
        header.push_str(content_type);
        header.push('\n');
    }
    header.push('\n');
    header.into_bytes()
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(2).position(|window| window == b"\n\n")
}

fn validate_content_type(value: &str) -> Result<(), VaultItemError> {
    if value.is_empty() || value.len() > MAX_CONTENT_TYPE_BYTES {
        return Err(VaultItemError::ContentTypeInvalid);
    }
    let Some((left, right)) = value.split_once('/') else {
        return Err(VaultItemError::ContentTypeInvalid);
    };
    let valid_part = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
    };
    if valid_part(left) && valid_part(right) {
        Ok(())
    } else {
        Err(VaultItemError::ContentTypeInvalid)
    }
}
