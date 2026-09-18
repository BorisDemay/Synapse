import type { Conflict, EncryptedPushOperation } from "@synapse/api-client";

import {
  noteKey,
  revisionKey,
  metaKey,
  openOfflineDb,
  type QueuedOperationRecord,
} from "./db";

export async function enqueueOperation(
  userId: string,
  operation: EncryptedPushOperation,
): Promise<void> {
  const db = await openOfflineDb();
  const record: QueuedOperationRecord = { ...operation, userId };
  await db.put("queue", record, operation.operation_id);
}

export async function listPendingOperations(
  userId: string,
  vaultId: string,
): Promise<EncryptedPushOperation[]> {
  const db = await openOfflineDb();
  const all = await db.getAll("queue");
  return all
    .filter(
      (row) =>
        row.userId === userId && row.vault_id === vaultId && !row.supersededBy,
    )
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    .map(
      ({
        conflict: _conflict,
        sequence: _sequence,
        userId: _userId,
        attempted: _attempted,
        rebaseRevision: _rebaseRevision,
        supersededBy: _supersededBy,
        ...operation
      }) => operation,
    );
}

export async function removeAckedOperation(
  userId: string,
  operationId: string,
): Promise<void> {
  const db = await openOfflineDb();
  const row = await db.get("queue", operationId);
  if (row?.userId === userId) {
    await db.delete("queue", operationId);
  }
}

/** The local edit and its delivery obligation commit together. */
export async function persistPendingOperation(
  userId: string,
  operation: EncryptedPushOperation,
  supersedes: string[] = [],
  localOnly = false,
): Promise<number> {
  const db = await openOfflineDb();
  const tx = db.transaction(
    ["notes", "queue", "note_revisions", "meta"],
    "readwrite",
  );
  try {
    await tx.objectStore("notes").put(
      {
        userId,
        vaultId: operation.vault_id,
        noteId: operation.note_id,
        revision: operation.base_revision,
        ciphertext: operation.ciphertext,
        ciphertextHash: operation.ciphertext_hash,
        nonce: operation.nonce,
      },
      noteKey(userId, operation.vault_id, operation.note_id),
    );
    const sequenceKey = `${userId}:${operation.vault_id}:outbox-sequence`;
    const counter = await tx.objectStore("meta").get(sequenceKey);
    const sequence =
      (typeof counter?.value === "number" ? counter.value : 0) + 1;
    await tx
      .objectStore("meta")
      .put({ key: sequenceKey, value: sequence }, sequenceKey);
    if (!localOnly)
      await tx
        .objectStore("queue")
        .put({ ...operation, userId, sequence }, operation.operation_id);
    const previous = await tx
      .objectStore("note_revisions")
      .getAll(
        IDBKeyRange.bound(
          `${userId}:${operation.vault_id}:${operation.note_id}:`,
          `${userId}:${operation.vault_id}:${operation.note_id}:\uffff`,
        ),
      );
    const revision =
      Math.max(
        operation.base_revision,
        ...previous.map((row) => row.revision),
      ) + 1;
    await tx.objectStore("note_revisions").put(
      {
        userId,
        vaultId: operation.vault_id,
        noteId: operation.note_id,
        baseRevision: operation.base_revision,
        revision,
        ciphertext: operation.ciphertext,
        nonce: operation.nonce,
        recordedAt: new Date().toISOString(),
      },
      revisionKey(userId, operation.vault_id, operation.note_id, revision),
    );
    for (const supersededId of supersedes) {
      const old = await tx.objectStore("queue").get(supersededId);
      if (
        old?.userId === userId &&
        old.note_id === operation.note_id &&
        old.vault_id === operation.vault_id
      )
        await tx
          .objectStore("queue")
          .put({ ...old, supersededBy: operation.operation_id }, supersededId);
    }
    await tx.done;
    return revision;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already aborted or committed. */
    }
    await tx.done.catch(() => {});
    throw error;
  }
}

/** Never replace a newer local ciphertext when an older operation is acknowledged. */
export async function acknowledgeOperation(
  userId: string,
  operation: EncryptedPushOperation,
  revision: number,
): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction(["queue", "meta"], "readwrite");
  try {
    const row = await tx.objectStore("queue").get(operation.operation_id);
    if (row?.userId === userId) {
      await tx.objectStore("queue").delete(operation.operation_id);
      // Only our own acknowledged transition can advance queued local dependencies.
      // Already attempted requests remain byte-for-byte immutable for crash replay.
      for (const next of await tx.objectStore("queue").getAll()) {
        if (
          next.userId === userId &&
          next.vault_id === operation.vault_id &&
          !next.attempted &&
          !next.supersededBy &&
          (next.rebaseRevision ?? next.base_revision) ===
            operation.base_revision
        ) {
          await tx
            .objectStore("queue")
            .put({ ...next, rebaseRevision: revision }, next.operation_id);
        }
      }
      const key = metaKey(userId, "head", operation.vault_id);
      const previous = await tx.objectStore("meta").get(key);
      await tx.objectStore("meta").put(
        {
          key,
          value: Math.max(
            typeof previous?.value === "number" ? previous.value : 0,
            revision,
          ),
        },
        key,
      );
    }
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already aborted or committed. */
    }
    await tx.done.catch(() => {});
    throw error;
  }
}

export async function prepareOperation(
  userId: string,
  operationId: string,
  reencrypt: (
    operation: EncryptedPushOperation,
    revision: number,
  ) => EncryptedPushOperation,
): Promise<EncryptedPushOperation | null> {
  const db = await openOfflineDb();
  const tx = db.transaction(["queue", "notes"], "readwrite");
  try {
    const row = await tx.objectStore("queue").get(operationId);
    if (!row || row.userId !== userId || row.supersededBy || row.conflict) {
      await tx.done;
      return null;
    }
    const {
      conflict: _conflict,
      sequence,
      userId: _userId,
      attempted,
      rebaseRevision,
      supersededBy: _superseded,
      ...original
    } = row;
    const operation =
      !attempted && rebaseRevision !== undefined
        ? reencrypt(original, rebaseRevision)
        : original;
    await tx
      .objectStore("queue")
      .put({ ...operation, userId, sequence, attempted: true }, operationId);
    const key = noteKey(userId, operation.vault_id, operation.note_id);
    const cached = await tx.objectStore("notes").get(key);
    if (cached?.ciphertextHash === original.ciphertext_hash)
      await tx.objectStore("notes").put(
        {
          ...cached,
          ciphertext: operation.ciphertext,
          ciphertextHash: operation.ciphertext_hash,
          nonce: operation.nonce,
          revision: operation.base_revision,
        },
        key,
      );
    await tx.done;
    return operation;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already aborted or committed. */
    }
    await tx.done.catch(() => {});
    throw error;
  }
}

export async function blockConflictedOperation(
  userId: string,
  operationId: string,
  conflict: Conflict | true,
): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction("queue", "readwrite");
  const row = await tx.store.get(operationId);
  if (row?.userId === userId && !row.supersededBy)
    await tx.store.put({ ...row, conflict }, operationId);
  await tx.done;
}
export async function getOperationConflict(
  userId: string,
  operationId: string,
): Promise<Conflict | true | undefined> {
  const row = await (await openOfflineDb()).get("queue", operationId);
  return row?.userId === userId ? row.conflict : undefined;
}
