use argon2::{Algorithm, Argon2, Params, Version};
use zeroize::Zeroizing;

use crate::EnvelopeError;

const ARGON2_MEMORY_KIB: u32 = 19 * 1024;
const ARGON2_ITERATIONS: u32 = 2;
const ARGON2_PARALLELISM: u32 = 1;

pub(crate) fn derive_wrapping_key(
    passphrase: &str,
    salt: &[u8; 16],
) -> Result<Zeroizing<[u8; 32]>, EnvelopeError> {
    let params = Params::new(
        ARGON2_MEMORY_KIB,
        ARGON2_ITERATIONS,
        ARGON2_PARALLELISM,
        Some(32),
    )
    .map_err(|_| EnvelopeError::KeyDerivationFailed)?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0_u8; 32]);

    argon2
        .hash_password_into(passphrase.as_bytes(), salt, &mut *key)
        .map_err(|_| EnvelopeError::KeyDerivationFailed)?;

    Ok(key)
}
