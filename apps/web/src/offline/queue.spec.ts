import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearUserOfflineData, resetOfflineDbHandle } from "./cache";
import {
  enqueueOperation,
  persistPendingOperation,
  prepareOperation,
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

  it("uses late edit provenance only before the first network attempt", async () => {
    const operation = sampleOp("immutable-provenance");
    await persistPendingOperation(userId, operation);
    let revision = 1;
    const reencrypt = vi.fn((original, base) => ({
      ...original,
      base_revision: base,
      ciphertext: [9, base],
    }));
    const first = await prepareOperation(
      userId,
      operation.operation_id,
      reencrypt,
      () => revision,
    );
    expect(first?.base_revision).toBe(1);
    revision = 2;
    const replay = await prepareOperation(
      userId,
      operation.operation_id,
      reencrypt,
      () => revision,
    );
    expect(replay).toEqual(first);
    expect(reencrypt).toHaveBeenCalledTimes(1);
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

  it("preserves every pending operation for the same note", async () => {
    const first = sampleOp("0198e5de-aaaa-7bbb-8ccc-ddddeeeefff1");
    const second = sampleOp("0198e5de-aaaa-7bbb-8ccc-ddddeeeefff2");
    second.ciphertext = [9, 9, 9];
    await enqueueOperation(userId, first);
    await enqueueOperation(userId, second);
    const pending = await listPendingOperations(userId, vaultId);
    expect(pending).toHaveLength(2);
    expect(pending[1]?.operation_id).toBe(second.operation_id);
    expect(pending[1]?.ciphertext).toEqual([9, 9, 9]);
  });
});

it("aborts the whole local transaction if the outbox write cannot be stored", async () => {
  const { persistPendingOperation } = await import("./queue");
  const { listCachedNotes } = await import("./cache");
  const operation = sampleOp(null as unknown as string);
  await expect(
    persistPendingOperation("atomic-user", operation),
  ).rejects.toThrow();
  expect(await listCachedNotes("atomic-user", vaultId)).toHaveLength(0);
});
