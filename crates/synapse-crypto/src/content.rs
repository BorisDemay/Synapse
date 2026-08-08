use std::{collections::HashSet, fmt, sync::Mutex};

use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305,
    aead::{Aead, AeadCore, OsRng, Payload},
};
use synapse_core::{NoteId, Revision, VaultId};
use zeroize::Zeroizing;

const AAD_VERSION: u8 = 1;

pub struct VaultKey(Zeroizing<[u8; 32]>);

impl VaultKey {
    pub fn generate() -> Self {
        let key = XChaCha20Poly1305::generate_key(&mut OsRng);
        let mut bytes = [0_u8; 32];
        bytes.copy_from_slice(&key);
        Self(Zeroizing::new(bytes))
    }

    pub(crate) fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub(crate) fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(Zeroizing::new(bytes))
    }
}

impl fmt::Debug for VaultKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("VaultKey([REDACTED])")
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Aad {
    vault_id: VaultId,
    note_id: NoteId,
    revision: Revision,
}

impl Aad {
    pub fn new(vault_id: VaultId, note_id: NoteId, revision: Revision) -> Self {
        Self {
            vault_id,
            note_id,
            revision,
        }
    }

    fn bytes(&self) -> Vec<u8> {
        format!(
            "synapse/aad/{AAD_VERSION}/{}/{}/{}",
            self.vault_id,
            self.note_id,
            self.revision.get()
        )
        .into_bytes()
    }
}

pub struct EncryptedContent {
    nonce: [u8; 24],
    ciphertext: Vec<u8>,
}

impl fmt::Debug for EncryptedContent {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("EncryptedContent")
            .field("ciphertext_len", &self.ciphertext.len())
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CryptoError {
    EncryptionFailed,
    DecryptionFailed,
    NonceAlreadyUsed,
}

impl fmt::Display for CryptoError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EncryptionFailed => formatter.write_str("content encryption failed"),
            Self::DecryptionFailed => formatter.write_str("content decryption failed"),
            Self::NonceAlreadyUsed => {
                formatter.write_str("content encryption nonce was already used")
            }
        }
    }
}

impl std::error::Error for CryptoError {}

pub struct VaultCipher {
    key: VaultKey,
    used_nonces: Mutex<HashSet<[u8; 24]>>,
}

impl VaultCipher {
    pub fn new(key: VaultKey) -> Self {
        Self {
            key,
            used_nonces: Mutex::new(HashSet::new()),
        }
    }

    pub fn encrypt(&self, aad: &Aad, plaintext: &[u8]) -> Result<EncryptedContent, CryptoError> {
        let nonce: [u8; 24] = XChaCha20Poly1305::generate_nonce(&mut OsRng).into();
        self.encrypt_with_nonce(aad, plaintext, nonce)
    }

    fn encrypt_with_nonce(
        &self,
        aad: &Aad,
        plaintext: &[u8],
        nonce: [u8; 24],
    ) -> Result<EncryptedContent, CryptoError> {
        let mut used_nonces = self
            .used_nonces
            .lock()
            .map_err(|_| CryptoError::EncryptionFailed)?;
        if !used_nonces.insert(nonce) {
            return Err(CryptoError::NonceAlreadyUsed);
        }
        drop(used_nonces);

        let cipher = XChaCha20Poly1305::new_from_slice(&self.key.0[..])
            .map_err(|_| CryptoError::EncryptionFailed)?;
        let ciphertext = cipher
            .encrypt(
                (&nonce).into(),
                Payload {
                    msg: plaintext,
                    aad: &aad.bytes(),
                },
            )
            .map_err(|_| CryptoError::EncryptionFailed)?;

        Ok(EncryptedContent { nonce, ciphertext })
    }

    pub fn decrypt(&self, aad: &Aad, content: &EncryptedContent) -> Result<Vec<u8>, CryptoError> {
        let cipher = XChaCha20Poly1305::new_from_slice(&self.key.0[..])
            .map_err(|_| CryptoError::DecryptionFailed)?;
        cipher
            .decrypt(
                (&content.nonce).into(),
                Payload {
                    msg: &content.ciphertext,
                    aad: &aad.bytes(),
                },
            )
            .map_err(|_| CryptoError::DecryptionFailed)
    }
}

#[cfg(test)]
mod tests {
    use synapse_core::{NoteId, Revision, VaultId};

    use super::{Aad, CryptoError, VaultCipher, VaultKey};

    #[test]
    fn rejects_reusing_a_nonce_for_encryption() {
        let cipher = VaultCipher::new(VaultKey::generate());
        let aad = Aad::new(
            VaultId::new(),
            NoteId::new(),
            Revision::new(1).expect("a positive revision"),
        );
        let nonce = [7_u8; 24];

        cipher
            .encrypt_with_nonce(&aad, b"first", nonce)
            .expect("first use succeeds");

        assert_eq!(
            cipher
                .encrypt_with_nonce(&aad, b"second", nonce)
                .expect_err("nonce reuse is rejected"),
            CryptoError::NonceAlreadyUsed
        );
    }
}
