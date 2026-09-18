use std::fmt;

use serde::Deserialize;
use synapse_protocol::v1::{Conflict, EncryptedPushOperation, PullRequest, PullResponse};
use uuid::Uuid;

/// Closed wake payload carried by the v1 WebSocket endpoint. It is a hint only:
/// consumers must pull from their durable cursor rather than interpret this one.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct WakeSignal {
    pub vault_id: String,
    pub cursor: String,
}

impl WakeSignal {
    pub fn parse(input: &str) -> Result<Self, TransportError> {
        let signal = serde_json::from_str::<Self>(input).map_err(|_| TransportError::Protocol)?;
        let vault_id = Uuid::parse_str(&signal.vault_id).map_err(|_| TransportError::Protocol)?;
        if vault_id.to_string() != signal.vault_id
            || synapse_protocol::v1::SyncCursor::new(signal.cursor.clone()).is_err()
        {
            return Err(TransportError::Protocol);
        }
        Ok(signal)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PushAck {
    pub operation_id: String,
    pub revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PullOutcome {
    Page(PullResponse),
    Conflict(Conflict),
    ResnapshotRequired,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TransportError {
    Network,
    Protocol,
    Conflict(Box<Conflict>),
}

impl fmt::Display for TransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Network => formatter.write_str("sync transport is unavailable"),
            Self::Protocol => formatter.write_str("sync protocol response is invalid"),
            Self::Conflict(_) => {
                formatter.write_str("sync operation conflicts with a remote revision")
            }
        }
    }
}

impl std::error::Error for TransportError {}

/// Injectable boundary for the versioned, encrypted sync protocol. It exposes
/// only opaque protocol values and never accepts vault filesystem data.
pub trait SyncTransport {
    fn push(&self, operation: EncryptedPushOperation) -> Result<PushAck, TransportError>;

    fn pull(&self, _: PullRequest) -> Result<PullOutcome, TransportError> {
        Ok(PullOutcome::Page(PullResponse {
            protocol_version: synapse_protocol::v1::PROTOCOL_VERSION,
            operations: Vec::new(),
            next_cursor: None,
        }))
    }
}

impl<F> SyncTransport for F
where
    F: Fn(EncryptedPushOperation) -> Result<PushAck, TransportError>,
{
    fn push(&self, operation: EncryptedPushOperation) -> Result<PushAck, TransportError> {
        self(operation)
    }
}
