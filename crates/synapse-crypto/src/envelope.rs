use std::fmt;

use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305,
    aead::{Aead, AeadCore, OsRng, Payload},
};
use rand_core::RngCore;
use serde::{Deserialize, Serialize};

use crate::{VaultKey, kdf::derive_wrapping_key};

const ENVELOPE_AAD: &[u8] = b"synapse/vault-key-envelope/v1";

#[derive(Deserialize, Serialize)]
pub struct WrappedVaultKey {
    salt: [u8; 16],
    nonce: [u8; 24],
    ciphertext: Vec<u8>,
}

impl fmt::Debug for WrappedVaultKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WrappedVaultKey")
            .field("ciphertext_len", &self.ciphertext.len())
            .finish_non_exhaustive()
    }
}

impl WrappedVaultKey {
    pub fn to_json(&self) -> Result<Vec<u8>, EnvelopeError> {
        serde_json::to_vec(self).map_err(|_| EnvelopeError::SerializationFailed)
    }

    pub fn from_json(value: &[u8]) -> Result<Self, EnvelopeError> {
        serde_json::from_slice(value).map_err(|_| EnvelopeError::InvalidEnvelope)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EnvelopeError {
    KeyDerivationFailed,
    WrappingFailed,
    UnwrappingFailed,
    SerializationFailed,
    InvalidEnvelope,
}

impl fmt::Display for EnvelopeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::KeyDerivationFailed => formatter.write_str("vault key derivation failed"),
            Self::WrappingFailed => formatter.write_str("vault key wrapping failed"),
            Self::UnwrappingFailed => formatter.write_str("vault key unwrapping failed"),
            Self::SerializationFailed => {
                formatter.write_str("wrapped vault key serialization failed")
            }
            Self::InvalidEnvelope => formatter.write_str("wrapped vault key is invalid"),
        }
    }
}

impl std::error::Error for EnvelopeError {}

pub fn wrap_vault_key(
    vault_key: &VaultKey,
    passphrase: &str,
) -> Result<WrappedVaultKey, EnvelopeError> {
    let mut salt = [0_u8; 16];
    OsRng.fill_bytes(&mut salt);
    let wrapping_key = derive_wrapping_key(passphrase, &salt)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&wrapping_key[..])
        .map_err(|_| EnvelopeError::WrappingFailed)?;
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: vault_key.as_bytes(),
                aad: ENVELOPE_AAD,
            },
        )
        .map_err(|_| EnvelopeError::WrappingFailed)?;

    Ok(WrappedVaultKey {
        salt,
        nonce: nonce.into(),
        ciphertext,
    })
}

pub fn unwrap_vault_key(
    wrapped: &WrappedVaultKey,
    passphrase: &str,
) -> Result<VaultKey, EnvelopeError> {
    let wrapping_key = derive_wrapping_key(passphrase, &wrapped.salt)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&wrapping_key[..])
        .map_err(|_| EnvelopeError::UnwrappingFailed)?;
    let key_bytes = cipher
        .decrypt(
            (&wrapped.nonce).into(),
            Payload {
                msg: &wrapped.ciphertext,
                aad: ENVELOPE_AAD,
            },
        )
        .map_err(|_| EnvelopeError::UnwrappingFailed)?;
    let key_bytes: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| EnvelopeError::InvalidEnvelope)?;

    Ok(VaultKey::from_bytes(key_bytes))
}
