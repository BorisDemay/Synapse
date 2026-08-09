use std::fmt;

use synapse_local_store::{LocalStore, StoreError};
use synapse_protocol::v1::{
    EncryptedPushOperation, MAX_PULL_LIMIT, PROTOCOL_VERSION, PullRequest, SyncCursor,
};

use crate::client::{PullOutcome, SyncTransport, TransportError, WakeSignal};

pub trait Jitter {
    fn jitter_millis(&self, upper_bound_millis: u64) -> u64;
}

impl<F> Jitter for F
where
    F: Fn(u64) -> u64,
{
    fn jitter_millis(&self, upper_bound_millis: u64) -> u64 {
        self(upper_bound_millis)
    }
}

pub trait RetryScheduler {
    fn schedule(&self, delay_millis: u64);
}

impl<F> RetryScheduler for F
where
    F: Fn(u64),
{
    fn schedule(&self, delay_millis: u64) {
        self(delay_millis);
    }
}

pub struct RetryPolicy<J, S> {
    max_attempts: u8,
    initial_backoff_millis: u64,
    max_backoff_millis: u64,
    jitter_bound_millis: u64,
    jitter: J,
    scheduler: S,
}

impl<J: Jitter, S: RetryScheduler> RetryPolicy<J, S> {
    pub fn exponential(
        max_attempts: u8,
        initial_backoff_millis: u64,
        max_backoff_millis: u64,
        jitter_bound_millis: u64,
        jitter: J,
        scheduler: S,
    ) -> Self {
        Self {
            max_attempts: max_attempts.max(1),
            initial_backoff_millis,
            max_backoff_millis: max_backoff_millis.max(initial_backoff_millis),
            jitter_bound_millis,
            jitter,
            scheduler,
        }
    }

    fn delay_millis(&self, retry: u8) -> u64 {
        let exponent = u32::from(retry.saturating_sub(1));
        let exponential_backoff = self
            .initial_backoff_millis
            .checked_shl(exponent)
            .unwrap_or(u64::MAX);
        let bounded_backoff = exponential_backoff.min(self.max_backoff_millis);
        let bounded_jitter = self
            .jitter
            .jitter_millis(self.jitter_bound_millis)
            .min(self.jitter_bound_millis);
        bounded_backoff.saturating_add(bounded_jitter)
    }
}

impl RetryPolicy<fn(u64) -> u64, fn(u64)> {
    pub fn without_delay(max_attempts: u8) -> Self {
        Self::exponential(max_attempts, 0, 0, 0, |_| 0, |_| {})
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SyncState {
    Synced,
    Pending,
    Conflict,
}

#[derive(Debug)]
pub enum SyncError {
    Store(StoreError),
    Protocol,
}

impl fmt::Display for SyncError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Store(_) => formatter.write_str("local sync state could not be persisted"),
            Self::Protocol => formatter.write_str("sync protocol response is invalid"),
        }
    }
}

impl std::error::Error for SyncError {}

impl From<StoreError> for SyncError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

/// Coordinates the durable opaque outbox. It deliberately does not decrypt,
/// merge, or write filesystem content while synchronizing.
pub struct SyncEngine<T, J, S> {
    store: LocalStore,
    transport: T,
    vault_id: String,
    retry_policy: RetryPolicy<J, S>,
}

impl<T, J, S> SyncEngine<T, J, S>
where
    T: SyncTransport,
    J: Jitter,
    S: RetryScheduler,
{
    pub fn new(
        store: LocalStore,
        transport: T,
        vault_id: impl Into<String>,
        retry_policy: RetryPolicy<J, S>,
    ) -> Self {
        Self {
            store,
            transport,
            vault_id: vault_id.into(),
            retry_policy,
        }
    }

    pub fn store(&self) -> &LocalStore {
        &self.store
    }

    pub fn synchronize(&mut self) -> Result<SyncState, SyncError> {
        for payload in self.store.pending_operation_payloads()? {
            let operation = serde_json::from_slice::<EncryptedPushOperation>(&payload)
                .map_err(|_| SyncError::Protocol)?;
            if operation.vault_id != self.vault_id {
                return Err(SyncError::Protocol);
            }
            match self.push_until_ack(&operation)? {
                SyncState::Synced => self
                    .store
                    .acknowledge_operation_id(&operation.operation_id)?,
                state => return Ok(state),
            }
        }

        self.pull_until_current_cursor()
    }

    /// A WebSocket wake is not an acknowledgement and never mutates the outbox.
    /// It only causes the regular pull to resume from the persisted cursor.
    pub fn wake_from_signal(&self, signal: &WakeSignal) -> Result<SyncState, SyncError> {
        if signal.vault_id != self.vault_id {
            return Err(SyncError::Protocol);
        }
        self.pull_until_current_cursor()
    }

    fn push_until_ack(&self, operation: &EncryptedPushOperation) -> Result<SyncState, SyncError> {
        for attempt in 1..=self.retry_policy.max_attempts {
            match self.transport.push(operation.clone()) {
                Ok(ack) if ack.operation_id == operation.operation_id => {
                    return Ok(SyncState::Synced);
                }
                Ok(_) => return Err(SyncError::Protocol),
                Err(TransportError::Network) if attempt == self.retry_policy.max_attempts => {
                    return Ok(SyncState::Pending);
                }
                Err(TransportError::Network) => {
                    self.retry_policy
                        .scheduler
                        .schedule(self.retry_policy.delay_millis(attempt));
                }
                Err(TransportError::Protocol) => return Err(SyncError::Protocol),
            }
        }
        Ok(SyncState::Pending)
    }

    fn pull_until_current_cursor(&self) -> Result<SyncState, SyncError> {
        let cursor = self
            .store
            .sync_cursor(&self.vault_id)?
            .map(SyncCursor::new)
            .transpose()
            .map_err(|_| SyncError::Protocol)?;
        match self.pull(cursor) {
            Err(TransportError::Network) => Ok(SyncState::Pending),
            Err(TransportError::Protocol) => Err(SyncError::Protocol),
            Ok(outcome) => self.handle_pull_outcome(outcome),
        }
    }

    fn handle_pull_outcome(&self, outcome: PullOutcome) -> Result<SyncState, SyncError> {
        match outcome {
            PullOutcome::Page(page) => {
                if page.protocol_version != PROTOCOL_VERSION {
                    return Err(SyncError::Protocol);
                }
                if let Some(next_cursor) = page.next_cursor {
                    self.store
                        .set_sync_cursor(&self.vault_id, next_cursor.as_str())?;
                }
                Ok(SyncState::Synced)
            }
            PullOutcome::Conflict(_) => Ok(SyncState::Conflict),
            PullOutcome::ResnapshotRequired => {
                self.store.clear_sync_cursor(&self.vault_id)?;
                match self.pull(None) {
                    Err(TransportError::Network) => Ok(SyncState::Pending),
                    Err(TransportError::Protocol) => Err(SyncError::Protocol),
                    Ok(outcome) => self.handle_resnapshot_outcome(outcome),
                }
            }
        }
    }

    fn handle_resnapshot_outcome(&self, outcome: PullOutcome) -> Result<SyncState, SyncError> {
        match outcome {
            PullOutcome::Page(page) if page.protocol_version == PROTOCOL_VERSION => {
                if let Some(next_cursor) = page.next_cursor {
                    self.store
                        .set_sync_cursor(&self.vault_id, next_cursor.as_str())?;
                }
                Ok(SyncState::Synced)
            }
            PullOutcome::Conflict(_) => Ok(SyncState::Conflict),
            PullOutcome::ResnapshotRequired | PullOutcome::Page(_) => Err(SyncError::Protocol),
        }
    }

    fn pull(&self, cursor: Option<SyncCursor>) -> Result<PullOutcome, TransportError> {
        self.transport.pull(PullRequest {
            protocol_version: PROTOCOL_VERSION,
            vault_id: self.vault_id.clone(),
            cursor,
            limit: MAX_PULL_LIMIT,
        })
    }
}
