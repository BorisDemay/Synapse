import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { clearUserOfflineData, resetOfflineDbHandle } from "./cache";
import {
  enqueueOperation,
  listPendingOperations,
  removeAckedOperation,
} from "./queue";

const userId = "0198e5de-user-7000-8000-000000000001";
const vaultId = "0198e5de-1111-7222-8333-444455556666";

function sampleOp(operationId: string) {
  return {
    aad_version: 1 as const,
    base_revision: 0,
    ciphertext: [1, 2, 3],
    ciphertext_hash: "ef".repeat(32),
    nonce: Array.from({ length: 24 }, (_, i) => i),
    note_id: "0198e5de-7777-7888-8999-aaaabbbbcccc",
    operation_id: operationId,
    protocol_version: 1 as const,
    vault_id: vaultId,
  };
}

describe("offline queue", () => {
  beforeEach(async () => {
    resetOfflineDbHandle();
    indexedDB.deleteDatabase("synapse-offline-v1");
    resetOfflineDbHandle();
    await clearUserOfflineData(userId);
  });

  it("keeps pending encrypted operations until they are acked", async () => {
    const first = sampleOp("0198e5de-aaaa-7bbb-8ccc-ddddeeeefff1");
    const second = sampleOp("0198e5de-aaaa-7bbb-8ccc-ddddeeeefff2");
    second.note_id = "0198e5de-7777-7888-8999-aaaabbbb9999";
    await enqueueOperation(userId, first);
    await enqueueOperation(userId, second);

    expect(await listPendingOperations(userId, vaultId)).toHaveLength(2);
    await removeAckedOperation(userId, first.operation_id);
    const remaining = await listPendingOperations(userId, vaultId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.operation_id).toBe(second.operation_id);
    expect(JSON.stringify(remaining)).not.toContain("# ");
  });

  it("replaces a pending operation for the same note", async () => {
    const first = sampleOp("0198e5de-aaaa-7bbb-8ccc-ddddeeeefff1");
    const second = sampleOp("0198e5de-aaaa-7bbb-8ccc-ddddeeeefff2");
    second.ciphertext = [9, 9, 9];
    await enqueueOperation(userId, first);
    await enqueueOperation(userId, second);
    const pending = await listPendingOperations(userId, vaultId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.operation_id).toBe(second.operation_id);
    expect(pending[0]?.ciphertext).toEqual([9, 9, 9]);
  });
});
