use std::fmt;

use synapse_protocol::v1::{Conflict, EncryptedPushOperation, PullRequest, PullResponse};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PushAck {
    pub operation_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PullOutcome {
    Page(PullResponse),
    Conflict(Conflict),
    ResnapshotRequired,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransportError {
    Network,
    Protocol,
}

impl fmt::Display for TransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Network => formatter.write_str("sync transport is unavailable"),
            Self::Protocol => formatter.write_str("sync protocol response is invalid"),
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
