use std::fmt;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_PULL_LIMIT: u32 = 100;
pub const RESNAPSHOT_REQUIRED_CODE: &str = "sync_cursor_resnapshot_required";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct SyncCursor(String);

impl SyncCursor {
    pub fn new(value: impl Into<String>) -> Result<Self, CursorError> {
        let value = value.into();
        if Uuid::parse_str(&value).is_err() {
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
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawEncryptedPushOperation {
    protocol_version: u8,
    operation_id: String,
    vault_id: String,
    note_id: String,
    base_revision: u64,
    ciphertext: Vec<u8>,
    nonce: Vec<u8>,
    aad_version: u8,
    ciphertext_hash: String,
    encrypted_vault_key_envelope: Option<Vec<u8>>,
}

impl<'de> Deserialize<'de> for EncryptedPushOperation {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawEncryptedPushOperation::deserialize(deserializer)?;
        if raw.protocol_version != PROTOCOL_VERSION
            || raw.aad_version != PROTOCOL_VERSION
            || raw.base_revision == 0
            || raw.nonce.len() != 24
            || raw.ciphertext.len() < 16
            || !is_uuid(&raw.operation_id)
            || !is_uuid(&raw.vault_id)
            || !is_uuid(&raw.note_id)
            || !is_ciphertext_hash(&raw.ciphertext_hash)
        {
            return Err(serde::de::Error::custom("encrypted operation is invalid"));
        }
        Ok(Self {
            protocol_version: raw.protocol_version,
            operation_id: raw.operation_id,
            vault_id: raw.vault_id,
            note_id: raw.note_id,
            base_revision: raw.base_revision,
            ciphertext: raw.ciphertext,
            nonce: raw.nonce,
            aad_version: raw.aad_version,
            ciphertext_hash: raw.ciphertext_hash,
            encrypted_vault_key_envelope: raw.encrypted_vault_key_envelope,
        })
    }
}

fn is_uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok()
}

fn is_ciphertext_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PullRequest {
    pub protocol_version: u8,
    pub vault_id: String,
    pub cursor: Option<SyncCursor>,
    pub limit: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPullRequest {
    protocol_version: u8,
    vault_id: String,
    cursor: Option<SyncCursor>,
    limit: u32,
}

impl<'de> Deserialize<'de> for PullRequest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawPullRequest::deserialize(deserializer)?;
        if raw.protocol_version != PROTOCOL_VERSION
            || !is_uuid(&raw.vault_id)
            || raw.limit == 0
            || raw.limit > MAX_PULL_LIMIT
        {
            return Err(serde::de::Error::custom("pull request is invalid"));
        }

        Ok(Self {
            protocol_version: raw.protocol_version,
            vault_id: raw.vault_id,
            cursor: raw.cursor,
            limit: raw.limit,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullResponse {
    pub protocol_version: u8,
    pub operations: Vec<EncryptedPushOperation>,
    pub next_cursor: Option<SyncCursor>,
}

/// The versioned error body returned with HTTP 409 when a pull cursor cannot
/// safely resume. Clients must retry the same pull with `cursor: null`.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ResnapshotRequired {
    pub protocol_version: u8,
    pub code: String,
    pub resnapshot_cursor: (),
}

impl ResnapshotRequired {
    pub fn new() -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            code: RESNAPSHOT_REQUIRED_CODE.into(),
            resnapshot_cursor: (),
        }
    }
}

impl Default for ResnapshotRequired {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawResnapshotRequired {
    protocol_version: u8,
    code: String,
    resnapshot_cursor: (),
}

impl<'de> Deserialize<'de> for ResnapshotRequired {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawResnapshotRequired::deserialize(deserializer)?;
        if raw.protocol_version != PROTOCOL_VERSION || raw.code != RESNAPSHOT_REQUIRED_CODE {
            return Err(serde::de::Error::custom("resnapshot error is invalid"));
        }

        Ok(Self {
            protocol_version: raw.protocol_version,
            code: raw.code,
            resnapshot_cursor: raw.resnapshot_cursor,
        })
    }
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
                "get": {
                    "summary": "Pull encrypted operations in strictly increasing server revision order",
                    "responses": {
                        "200": {
                            "description": "A stable page of encrypted operations",
                            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/PullResponse" } } }
                        },
                        "409": {
                            "description": "The opaque cursor is unknown, belongs to another vault or user, or predates retention; retry with cursor null",
                            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ResnapshotRequired" } } }
                        }
                    }
                }
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
                    "required": ["protocol_version", "vault_id", "cursor", "limit"],
                    "properties": { "protocol_version": { "type": "integer", "const": PROTOCOL_VERSION }, "vault_id": { "type": "string", "format": "uuid" }, "cursor": { "type": ["string", "null"], "format": "uuid" }, "limit": { "type": "integer", "minimum": 1, "maximum": MAX_PULL_LIMIT } }
                },
                "PullResponse": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["protocol_version", "operations", "next_cursor"],
                    "properties": { "protocol_version": { "type": "integer", "const": PROTOCOL_VERSION }, "operations": { "type": "array", "items": { "$ref": "#/components/schemas/EncryptedPushOperation" } }, "next_cursor": { "type": ["string", "null"], "format": "uuid" } }
                },
                "ResnapshotRequired": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["protocol_version", "code", "resnapshot_cursor"],
                    "properties": { "protocol_version": { "type": "integer", "const": PROTOCOL_VERSION }, "code": { "type": "string", "const": RESNAPSHOT_REQUIRED_CODE }, "resnapshot_cursor": { "type": "null" } }
                },
                "Conflict": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["protocol_version", "operation_id", "vault_id", "note_id", "base_revision", "remote_revision", "base_ciphertext_hash", "local_ciphertext_hash", "remote_ciphertext_hash"],
                    "properties": { "protocol_version": { "const": PROTOCOL_VERSION }, "operation_id": { "format": "uuid" }, "vault_id": { "format": "uuid" }, "note_id": { "format": "uuid" }, "base_revision": { "minimum": 1 }, "remote_revision": { "minimum": 1 }, "base_ciphertext_hash": { "pattern": "^[a-f0-9]{64}$" }, "local_ciphertext_hash": { "pattern": "^[a-f0-9]{64}$" }, "remote_ciphertext_hash": { "pattern": "^[a-f0-9]{64}$" } }
                }
            }
        }
    })
}
