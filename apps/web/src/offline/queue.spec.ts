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

  it("keeps recovery snapshots five minutes apart without replacing the outbox edit", async () => {
    const { listNoteRevisions } = await import("./cache");
    const first = sampleOp("snapshot-first");
    const second = sampleOp("snapshot-second");
    second.base_revision = 1;
    second.ciphertext = [4, 5, 6];
    await persistPendingOperation(userId, first);
    await persistPendingOperation(userId, second);
    const revisions = await listNoteRevisions(userId, vaultId, first.note_id);
    expect(revisions.filter((row) => row.recoverySnapshot)).toHaveLength(1);
    expect(
      (await listPendingOperations(userId, vaultId)).map(
        (row) => row.operation_id,
      ),
    ).toEqual(["snapshot-first", "snapshot-second"]);
    expect(revisions[0]?.ciphertext).toEqual([1, 2, 3]);
  });

  it("expires only its own snapshots on a later save and preserves named targets", async () => {
    const { listNoteRevisions } = await import("./cache");
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-09-24T12:00:00.000Z").getTime());
    const first = sampleOp("retention-first");
    await persistPendingOperation(userId, first);
    const initial = (
      await listNoteRevisions(userId, vaultId, first.note_id)
    )[0]!;
    now.mockReturnValue(new Date("2026-09-24T12:06:00.000Z").getTime());
    const second = sampleOp("retention-second");
    second.base_revision = 1;
    await persistPendingOperation(userId, second);
    const secondSnapshot = (
      await listNoteRevisions(userId, vaultId, first.note_id)
    ).find((row) => row.revision !== initial.revision)!;
    now.mockReturnValue(new Date("2026-10-03T12:00:00.000Z").getTime());
    const next = sampleOp("retention-next");
    next.base_revision = 2;
    await persistPendingOperation(userId, next, [], false, {
      preserveRevisions: [initial.revision],
    });
    const retained = await listNoteRevisions(userId, vaultId, first.note_id);
    expect(retained.map((row) => row.revision)).toContain(initial.revision);
    expect(retained.map((row) => row.revision)).not.toContain(
      secondSnapshot.revision,
    );
    expect(await listPendingOperations(userId, vaultId)).toHaveLength(3);
    now.mockRestore();
  });

  it("prunes invalid tagged snapshots later but preserves named and legacy revisions", async () => {
    const { listNoteRevisions } = await import("./cache");
    const { openOfflineDb, revisionKey } = await import("./db");
    const first = sampleOp("invalid-retention-first");
    await persistPendingOperation(userId, first);
    const revisions = await listNoteRevisions(userId, vaultId, first.note_id);
    const invalid = revisions[0]!;
    const { recoverySnapshot: _tag, ...legacyFields } = invalid;
    const legacy = {
      ...legacyFields,
      revision: invalid.revision + 100,
      recordedAt: "not-a-date",
    };
    const db = await openOfflineDb();
    await db.put(
      "note_revisions",
      { ...invalid, recordedAt: "not-a-date" },
      revisionKey(userId, vaultId, first.note_id, invalid.revision),
    );
    await db.put(
      "note_revisions",
      legacy,
      revisionKey(userId, vaultId, first.note_id, legacy.revision),
    );
    const next = sampleOp("invalid-retention-next");
    next.base_revision = 1;
    await persistPendingOperation(userId, next, [], false, {
      preserveRevisions: [invalid.revision],
    });
    let remaining = await listNoteRevisions(userId, vaultId, first.note_id);
    expect(remaining.map((row) => row.revision)).toContain(invalid.revision);
    expect(remaining.map((row) => row.revision)).toContain(legacy.revision);
    const later = sampleOp("invalid-retention-later");
    later.base_revision = 2;
    await persistPendingOperation(userId, later);
    remaining = await listNoteRevisions(userId, vaultId, first.note_id);
    expect(remaining.map((row) => row.revision)).not.toContain(
      invalid.revision,
    );
    expect(remaining.map((row) => row.revision)).toContain(legacy.revision);
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
