use std::fmt;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};

pub const PROTOCOL_VERSION: u8 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct SyncCursor(String);

impl SyncCursor {
    pub fn new(value: impl Into<String>) -> Result<Self, CursorError> {
        let value = value.into();
        if value.is_empty() || value.len() > 512 || value.chars().any(char::is_control) {
            return Err(CursorError::Invalid);
        }

        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CursorError {
    Invalid,
}

impl fmt::Display for CursorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("sync cursor is invalid")
    }
}

impl std::error::Error for CursorError {}

impl<'de> Deserialize<'de> for SyncCursor {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

/// An opaque, client-encrypted mutation. It deliberately has no plaintext title,
/// path, tag, preview, or Markdown field.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncryptedPushOperation {
    pub protocol_version: u8,
    pub operation_id: String,
    pub vault_id: String,
    pub note_id: String,
    pub base_revision: u64,
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    pub aad_version: u8,
    pub ciphertext_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encrypted_vault_key_envelope: Option<Vec<u8>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequest {
    pub protocol_version: u8,
    pub vault_id: String,
    pub cursor: Option<SyncCursor>,
    pub limit: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullResponse {
    pub protocol_version: u8,
    pub operations: Vec<EncryptedPushOperation>,
    pub next_cursor: Option<SyncCursor>,
}

/// The server reports only opaque ciphertext references. A client that has
/// unlocked the vault is solely responsible for decrypting and merging them.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Conflict {
    pub protocol_version: u8,
    pub operation_id: String,
    pub vault_id: String,
    pub note_id: String,
    pub base_revision: u64,
    pub remote_revision: u64,
    pub base_ciphertext_hash: String,
    pub local_ciphertext_hash: String,
    pub remote_ciphertext_hash: String,
}

/// Produces the checked-in OpenAPI contract without inspecting user data or
/// accepting plaintext content fields.
pub fn openapi_document() -> Value {
    json!({
        "openapi": "3.1.0",
        "info": {
            "title": "Synapse encrypted sync API",
            "version": PROTOCOL_VERSION.to_string(),
            "license": { "name": "AGPL-3.0-or-later" }
        },
        "paths": {
            "/v1/vaults/{vault_id}/operations": {
                "post": { "summary": "Push an encrypted operation" },
                "get": { "summary": "Pull encrypted operations" }
            }
        },
        "components": {
            "schemas": {
                "EncryptedPushOperation": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["protocol_version", "operation_id", "vault_id", "note_id", "base_revision", "ciphertext", "nonce", "aad_version", "ciphertext_hash"],
                    "properties": {
                        "protocol_version": { "type": "integer", "const": PROTOCOL_VERSION },
                        "operation_id": { "type": "string", "format": "uuid" },
                        "vault_id": { "type": "string", "format": "uuid" },
                        "note_id": { "type": "string", "format": "uuid" },
                        "base_revision": { "type": "integer", "minimum": 1 },
                        "ciphertext": { "type": "array", "items": { "type": "integer", "minimum": 0, "maximum": 255 } },
                        "nonce": { "type": "array", "items": { "type": "integer", "minimum": 0, "maximum": 255 }, "minItems": 24, "maxItems": 24 },
                        "aad_version": { "type": "integer", "minimum": 1 },
                        "ciphertext_hash": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
                        "encrypted_vault_key_envelope": { "type": "array", "items": { "type": "integer", "minimum": 0, "maximum": 255 } }
                    }
                },
                "PullRequest": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["protocol_version", "vault_id", "cursor", "limit"]
                },
                "PullResponse": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["protocol_version", "operations", "next_cursor"]
                },
                "Conflict": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["protocol_version", "operation_id", "vault_id", "note_id", "base_revision", "remote_revision", "base_ciphertext_hash", "local_ciphertext_hash", "remote_ciphertext_hash"]
                }
            }
        }
    })
}
