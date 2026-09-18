use std::fmt;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EncryptedVariant {
    pub revision: u64,
    pub ciphertext: Vec<u8>,
}

pub trait CiphertextCodec {
    fn decrypt(&self, ciphertext: &EncryptedVariant) -> Result<Vec<u8>, ConflictError>;
    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, ConflictError>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ConflictOutcome {
    AutomaticResolution {
        revision: u64,
        ciphertext: Vec<u8>,
    },
    ManualResolutionRequired {
        base: EncryptedVariant,
        local: EncryptedVariant,
        remote: EncryptedVariant,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConflictError {
    Ciphertext,
    InvalidRevision,
}

impl fmt::Display for ConflictError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("encrypted conflict processing failed")
    }
}

impl std::error::Error for ConflictError {}

pub fn resolve<C: CiphertextCodec>(
    codec: &C,
    base: EncryptedVariant,
    local: EncryptedVariant,
    remote: EncryptedVariant,
) -> Result<ConflictOutcome, ConflictError> {
    let base_plaintext = codec.decrypt(&base)?;
    let local_plaintext = codec.decrypt(&local)?;
    let remote_plaintext = codec.decrypt(&remote)?;
    match merge_disjoint(&base_plaintext, &local_plaintext, &remote_plaintext) {
        Some(plaintext) => Ok(ConflictOutcome::AutomaticResolution {
            revision: remote
                .revision
                .checked_add(1)
                .ok_or(ConflictError::InvalidRevision)?,
            ciphertext: codec.encrypt(&plaintext)?,
        }),
        None => Ok(ConflictOutcome::ManualResolutionRequired {
            base,
            local,
            remote,
        }),
    }
}

pub fn record_manual_resolution<C: CiphertextCodec>(
    codec: &C,
    remote_revision: u64,
    resolved_plaintext: &[u8],
) -> Result<ConflictOutcome, ConflictError> {
    let revision = remote_revision
        .checked_add(1)
        .ok_or(ConflictError::InvalidRevision)?;
    Ok(ConflictOutcome::AutomaticResolution {
        revision,
        ciphertext: codec.encrypt(resolved_plaintext)?,
    })
}

struct Change {
    start: usize,
    end: usize,
    replacement: Vec<Vec<u8>>,
}

fn merge_disjoint(base: &[u8], local: &[u8], remote: &[u8]) -> Option<Vec<u8>> {
    let base_lines = lines(base);
    let local_change = change(&base_lines, &lines(local));
    let remote_change = change(&base_lines, &lines(remote));

    if local_change.end <= remote_change.start {
        return Some(render_merged(&base_lines, &local_change, &remote_change));
    }
    if remote_change.end <= local_change.start {
        return Some(render_merged(&base_lines, &remote_change, &local_change));
    }
    None
}

fn lines(value: &[u8]) -> Vec<Vec<u8>> {
    value
        .split_inclusive(|byte| *byte == b'\n')
        .map(Vec::from)
        .collect()
}

fn change(base: &[Vec<u8>], variant: &[Vec<u8>]) -> Change {
    let mut start = 0;
    while start < base.len() && start < variant.len() && base[start] == variant[start] {
        start += 1;
    }
    let mut base_end = base.len();
    let mut variant_end = variant.len();
    while base_end > start && variant_end > start && base[base_end - 1] == variant[variant_end - 1]
    {
        base_end -= 1;
        variant_end -= 1;
    }
    Change {
        start,
        end: base_end,
        replacement: variant[start..variant_end].to_vec(),
    }
}

fn render_merged(base: &[Vec<u8>], first: &Change, second: &Change) -> Vec<u8> {
    let mut merged = Vec::new();
    for line in &base[..first.start] {
        merged.extend(line);
    }
    for line in &first.replacement {
        merged.extend(line);
    }
    for line in &base[first.end..second.start] {
        merged.extend(line);
    }
    for line in &second.replacement {
        merged.extend(line);
    }
    for line in &base[second.end..] {
        merged.extend(line);
    }
    merged
}
