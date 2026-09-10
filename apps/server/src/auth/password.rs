use argon2::{
    Algorithm, Argon2, PasswordHash, PasswordHasher, PasswordVerifier, Version,
    password_hash::SaltString,
};
use rand::rngs::OsRng;
use std::sync::{
    Arc, OnceLock,
    atomic::{AtomicUsize, Ordering},
};
use tokio::{
    sync::Semaphore,
    time::{Duration, timeout},
};

const MINIMUM_PASSWORD_LENGTH: usize = 12;
const MAXIMUM_PASSWORD_LENGTH: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasswordError {
    Invalid,
    Hashing,
    Busy,
}

impl std::fmt::Display for PasswordError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("invalid authentication credential")
    }
}

struct HashGate {
    permits: Arc<Semaphore>,
    queued: AtomicUsize,
}

struct QueueGuard<'a> {
    queued: &'a AtomicUsize,
}

impl Drop for QueueGuard<'_> {
    fn drop(&mut self) {
        self.queued.fetch_sub(1, Ordering::AcqRel);
    }
}

static HASH_GATE: OnceLock<HashGate> = OnceLock::new();

fn hash_gate() -> &'static HashGate {
    HASH_GATE.get_or_init(|| HashGate {
        permits: Arc::new(Semaphore::new(2)),
        queued: AtomicUsize::new(0),
    })
}

async fn run_blocking<T, F>(job: F) -> Result<T, PasswordError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, PasswordError> + Send + 'static,
{
    let gate = hash_gate();
    let mut queued = gate.queued.load(Ordering::Acquire);
    loop {
        if queued >= 10 {
            return Err(PasswordError::Busy);
        }
        match gate.queued.compare_exchange_weak(
            queued,
            queued + 1,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => break,
            Err(actual) => queued = actual,
        }
    }
    let queue_guard = QueueGuard {
        queued: &gate.queued,
    };
    let permit = match timeout(Duration::from_secs(5), gate.permits.clone().acquire_owned()).await {
        Ok(Ok(permit)) => permit,
        Ok(Err(_)) | Err(_) => return Err(PasswordError::Busy),
    };
    drop(queue_guard);
    let result = tokio::task::spawn_blocking(job)
        .await
        .map_err(|_| PasswordError::Hashing)?;
    drop(permit);
    result
}

pub async fn hash_async(password: String) -> Result<String, PasswordError> {
    validate_hash_input(&password)?;
    run_blocking(move || hash(&password)).await
}

pub async fn verify_async(password: String, encoded: String) -> Result<(), PasswordError> {
    if password.len() > MAXIMUM_PASSWORD_LENGTH {
        return Err(PasswordError::Invalid);
    }
    run_blocking(move || verify(&password, &encoded)).await
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
    validate_hash_input(password)?;
    hash_unconstrained(password)
}

fn validate_hash_input(password: &str) -> Result<(), PasswordError> {
    if !(MINIMUM_PASSWORD_LENGTH..=MAXIMUM_PASSWORD_LENGTH).contains(&password.len()) {
        return Err(PasswordError::Invalid);
    }
    Ok(())
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
    if password.len() > MAXIMUM_PASSWORD_LENGTH {
        return Err(PasswordError::Invalid);
    }
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

    #[tokio::test]
    async fn cancelled_hash_wait_does_not_consume_queue_capacity() {
        let gate = hash_gate();
        let first = gate
            .permits
            .clone()
            .acquire_owned()
            .await
            .expect("first permit");
        let second = gate
            .permits
            .clone()
            .acquire_owned()
            .await
            .expect("second permit");
        let queued_before = gate.queued.load(Ordering::Acquire);
        let task = tokio::spawn(run_blocking(|| Ok::<_, PasswordError>(())));
        for _ in 0..100 {
            if gate.queued.load(Ordering::Acquire) > queued_before {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert_eq!(gate.queued.load(Ordering::Acquire), queued_before + 1);
        task.abort();
        let _ = task.await;
        assert_eq!(gate.queued.load(Ordering::Acquire), queued_before);
        drop(first);
        drop(second);
    }
}
