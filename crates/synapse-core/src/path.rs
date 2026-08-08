use std::error::Error;
use std::fmt;

#[derive(Clone, Debug, Eq, PartialEq, Hash, Ord, PartialOrd)]
pub struct VaultPath(String);

impl VaultPath {
    pub fn parse(value: &str) -> Result<Self, VaultPathError> {
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

        if !normalized.ends_with(".md") {
            return Err(VaultPathError::UnsupportedNoteExtension);
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
    Empty,
    NulByte,
    ParentSegment,
    UnsupportedNoteExtension,
    WindowsAmbiguousSegment,
}

impl fmt::Display for VaultPathError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Absolute => "vault path must be relative",
            Self::Empty => "vault path is empty",
            Self::NulByte => "vault path contains a NUL byte",
            Self::ParentSegment => "vault path contains a parent segment",
            Self::UnsupportedNoteExtension => "vault path has an unsupported note extension",
            Self::WindowsAmbiguousSegment => "vault path contains a Windows-ambiguous segment",
        })
    }
}

impl Error for VaultPathError {}
