// Generated from crates/synapse-protocol/schema/openapi.json. DO NOT EDIT.
import type { EncryptedPushOperation } from "./types";

export function serializeEncryptedPushOperation(
  operation: EncryptedPushOperation,
): string {
  return JSON.stringify(operation);
}

export function buildPullOperationsPath(
  vaultId: string,
  options: { cursor?: string | null; limit: number },
): string {
  const params = new URLSearchParams();
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  params.set("limit", String(options.limit));
  return `/v1/vaults/${vaultId}/operations?${params.toString()}`;
}
