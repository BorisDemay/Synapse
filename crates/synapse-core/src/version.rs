use std::fmt;
use std::num::NonZeroU64;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Ord, PartialOrd)]
pub struct Revision(NonZeroU64);

impl Revision {
    pub fn new(value: u64) -> Result<Self, RevisionError> {
        NonZeroU64::new(value).map(Self).ok_or(RevisionError::Zero)
    }

    pub fn get(self) -> u64 {
        self.0.get()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RevisionError {
    Zero,
}

impl fmt::Display for RevisionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("revision must be strictly positive")
    }
}

impl std::error::Error for RevisionError {}
