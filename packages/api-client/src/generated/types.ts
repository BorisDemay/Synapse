// Generated from crates/synapse-protocol/schema/openapi.json. DO NOT EDIT.

export interface Conflict {
  base_ciphertext_hash: string;
  base_revision: number;
  local_ciphertext_hash: string;
  note_id: string;
  operation_id: string;
  protocol_version: 1;
  remote_ciphertext_hash: string;
  remote_revision: number;
  vault_id: string;
}
export interface EncryptedPushOperation {
  aad_version: number;
  base_revision: number;
  ciphertext: number[];
  ciphertext_hash: string;
  encrypted_vault_key_envelope?: number[];
  nonce: number[];
  note_id: string;
  operation_id: string;
  protocol_version: 1;
  vault_id: string;
}
export interface PullRequest {
  cursor: string | null;
  limit: number;
  protocol_version: 1;
  vault_id: string;
}
export interface PullResponse {
  next_cursor: string | null;
  operations: EncryptedPushOperation[];
  protocol_version: 1;
}
export interface ResnapshotRequired {
  code: "sync_cursor_resnapshot_required";
  protocol_version: 1;
  resnapshot_cursor: null;
}
