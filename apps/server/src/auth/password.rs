use argon2::{
    Algorithm, Argon2, PasswordHash, PasswordHasher, PasswordVerifier, Version,
    password_hash::SaltString,
};
use rand::rngs::OsRng;

const MINIMUM_PASSWORD_LENGTH: usize = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasswordError {
    Invalid,
    Hashing,
}

impl std::fmt::Display for PasswordError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("invalid authentication credential")
    }
}

impl std::error::Error for PasswordError {}

fn argon2id() -> Argon2<'static> {
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        argon2::Params::default(),
    )
}

pub fn hash(password: &str) -> Result<String, PasswordError> {
    if password.len() < MINIMUM_PASSWORD_LENGTH {
        return Err(PasswordError::Invalid);
    }
    hash_unconstrained(password)
}

/// Hashes a password without the public length policy. Used only to seed the
/// local development fixture account.
pub(crate) fn hash_unconstrained(password: &str) -> Result<String, PasswordError> {
    if password.is_empty() {
        return Err(PasswordError::Invalid);
    }

    argon2id()
        .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
        .map(|encoded| encoded.to_string())
        .map_err(|_| PasswordError::Hashing)
}

pub fn verify(password: &str, encoded: &str) -> Result<(), PasswordError> {
    let parsed = PasswordHash::new(encoded).map_err(|_| PasswordError::Invalid)?;
    argon2id()
        .verify_password(password.as_bytes(), &parsed)
        .map_err(|_| PasswordError::Invalid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_hash_keeps_the_length_policy() {
        assert!(hash("test").is_err());
        let encoded = hash_unconstrained("test").expect("fixture password hashes");
        assert!(encoded.starts_with("$argon2id$"));
        assert!(verify("test", &encoded).is_ok());
        assert!(verify("wrong", &encoded).is_err());
    }
}
