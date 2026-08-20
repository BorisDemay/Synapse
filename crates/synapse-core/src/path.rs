use std::error::Error;
use std::fmt;

const BLOCKED_ATTACHMENT_EXTENSIONS: &[&str] =
    &["bat", "cmd", "com", "dll", "exe", "ps1", "scr", "so"];

#[derive(Clone, Debug, Eq, PartialEq, Hash, Ord, PartialOrd)]
pub struct VaultPath(String);

#[derive(Clone, Debug, Eq, PartialEq, Hash, Ord, PartialOrd)]
pub struct VaultAssetPath(String);

fn normalize_relative_path(value: &str) -> Result<String, VaultPathError> {
    if value.is_empty() {
        return Err(VaultPathError::Empty);
    }

    if value.contains('\0') {
        return Err(VaultPathError::NulByte);
    }

    if value.split(['/', '\\']).any(|segment| segment == "..") {
        return Err(VaultPathError::ParentSegment);
    }

    if value
        .split(['/', '\\'])
        .any(|segment| segment.ends_with([' ', '.']) || segment.contains(':'))
    {
        return Err(VaultPathError::WindowsAmbiguousSegment);
    }

    let normalized = value.replace('\\', "/");
    if normalized.starts_with('/')
        || normalized.starts_with("//")
        || normalized
            .as_bytes()
            .get(1)
            .is_some_and(|byte| *byte == b':')
    {
        return Err(VaultPathError::Absolute);
    }

    if normalized.contains('\n') || normalized.contains('\r') {
        return Err(VaultPathError::InvalidCharacter);
    }

    Ok(normalized)
}

impl VaultPath {
    pub fn parse(value: &str) -> Result<Self, VaultPathError> {
        let normalized = normalize_relative_path(value)?;
        if !normalized.ends_with(".md") {
            return Err(VaultPathError::UnsupportedNoteExtension);
        }

        Ok(Self(normalized))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn file_stem(&self) -> &str {
        self.0
            .rsplit('/')
            .next()
            .unwrap_or(&self.0)
            .trim_end_matches(".md")
    }

    pub fn parent(&self) -> Option<&str> {
        self.0.rsplit_once('/').map(|(parent, _)| parent)
    }
}

impl VaultAssetPath {
    pub fn parse(value: &str) -> Result<Self, VaultPathError> {
        let normalized = normalize_relative_path(value)?;
        if !normalized.starts_with("attachments/") || normalized == "attachments/" {
            return Err(VaultPathError::UnsupportedAttachmentPath);
        }
        if normalized[12..].contains("attachments/") {
            return Err(VaultPathError::UnsupportedAttachmentPath);
        }
        let extension = normalized
            .rsplit('.')
            .next()
            .filter(|part| part.len() < normalized.len())
            .unwrap_or("");
        if BLOCKED_ATTACHMENT_EXTENSIONS
            .iter()
            .any(|blocked| extension.eq_ignore_ascii_case(blocked))
        {
            return Err(VaultPathError::BlockedAttachmentExtension);
        }

        Ok(Self(normalized))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VaultPathError {
    Absolute,
    BlockedAttachmentExtension,
    Empty,
    InvalidCharacter,
    NulByte,
    ParentSegment,
    UnsupportedAttachmentPath,
    UnsupportedNoteExtension,
    WindowsAmbiguousSegment,
}

impl fmt::Display for VaultPathError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Absolute => "vault path must be relative",
            Self::BlockedAttachmentExtension => "attachment extension is blocked",
            Self::Empty => "vault path is empty",
            Self::InvalidCharacter => "vault path contains an invalid character",
            Self::NulByte => "vault path contains a NUL byte",
            Self::ParentSegment => "vault path contains a parent segment",
            Self::UnsupportedAttachmentPath => {
                "attachment path must be under the attachments directory"
            }
            Self::UnsupportedNoteExtension => "vault path has an unsupported note extension",
            Self::WindowsAmbiguousSegment => "vault path contains a Windows-ambiguous segment",
        })
    }
}

impl Error for VaultPathError {}
