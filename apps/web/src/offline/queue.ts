import type { EncryptedPushOperation } from "@synapse/api-client";

import { openOfflineDb, type QueuedOperationRecord } from "./db";

export async function enqueueOperation(
  userId: string,
  operation: EncryptedPushOperation,
): Promise<void> {
  const db = await openOfflineDb();
  const existing = await db.getAll("queue");
  await Promise.all(
    existing
      .filter(
        (row) =>
          row.userId === userId &&
          row.vault_id === operation.vault_id &&
          row.note_id === operation.note_id,
      )
      .map((row) => db.delete("queue", row.operation_id)),
  );
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
    .filter((row) => row.userId === userId && row.vault_id === vaultId)
    .map(({ userId: _userId, ...operation }) => operation);
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
