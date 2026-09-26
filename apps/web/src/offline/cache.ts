import {
  assistantConversationsKey,
  assistantCredentialKey,
  closeOfflineDb,
  envelopeKey,
  metaKey,
  noteKey,
  openOfflineDb,
  resetOfflineDbHandle,
  revisionKey,
  type CachedAssistantCredentialRecord,
  type CachedAssistantConversationsRecord,
  type CachedNoteRecord,
  type CachedRevisionRecord,
  type CachedVaultPreferencesRecord,
  trustedDeviceKey,
  vaultPreferencesKey,
  type TrustedDeviceRecord,
} from "./db";

export type {
  CachedAssistantCredentialRecord,
  CachedAssistantConversationsRecord,
  CachedNoteRecord,
  CachedRevisionRecord,
  CachedVaultPreferencesRecord,
  TrustedDeviceRecord,
};

export { closeOfflineDb, openOfflineDb, resetOfflineDbHandle };

export async function putCachedNote(
  userId: string,
  record: Omit<CachedNoteRecord, "userId">,
): Promise<void> {
  const db = await openOfflineDb();
  const value: CachedNoteRecord = { ...record, userId };
  await db.put("notes", value, noteKey(userId, record.vaultId, record.noteId));
}

export async function listCachedNotes(
  userId: string,
  vaultId: string,
): Promise<CachedNoteRecord[]> {
  const db = await openOfflineDb();
  const prefix = `${userId}:${vaultId}:`;
  const rows: CachedNoteRecord[] = [];
  let range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
  const tx = db.transaction("notes", "readonly");
  for (;;) {
    const [batch, keys] = await Promise.all([
      tx.store.getAll(range, 256),
      tx.store.getAllKeys(range, 256),
    ]);
    rows.push(
      ...batch.filter(
        (note) => note.userId === userId && note.vaultId === vaultId,
      ),
    );
    if (batch.length < 256) {
      await tx.done;
      return rows;
    }
    range = IDBKeyRange.bound(keys[keys.length - 1]!, `${prefix}\uffff`, true);
  }
}

export async function putCachedEnvelope(
  userId: string,
  vaultId: string,
  bytes: number[],
): Promise<void> {
  const db = await openOfflineDb();
  await db.put(
    "envelopes",
    { bytes, userId, vaultId },
    envelopeKey(userId, vaultId),
  );
}

export async function getCachedEnvelope(
  userId: string,
  vaultId: string,
): Promise<number[] | null> {
  const db = await openOfflineDb();
  const row = await db.get("envelopes", envelopeKey(userId, vaultId));
  return row?.bytes ?? null;
}

export async function putTrustedDevice(
  record: TrustedDeviceRecord,
): Promise<void> {
  const db = await openOfflineDb();
  await db.put(
    "trusted_devices",
    record,
    trustedDeviceKey(record.userId, record.vaultId),
  );
}

export async function getTrustedDevice(
  userId: string,
  vaultId: string,
): Promise<TrustedDeviceRecord | null> {
  const db = await openOfflineDb();
  const records = await db.getAll("trusted_devices");
  return (
    records.find(
      (record) => record.userId === userId && record.vaultId === vaultId,
    ) ?? null
  );
}

export async function deleteTrustedDevice(
  record: TrustedDeviceRecord,
): Promise<void> {
  const db = await openOfflineDb();
  await db.delete(
    "trusted_devices",
    trustedDeviceKey(record.userId, record.vaultId),
  );
}

export async function putAssistantCredential(
  record: CachedAssistantCredentialRecord,
): Promise<void> {
  const db = await openOfflineDb();
  await db.put(
    "ai_credentials",
    record,
    assistantCredentialKey(record.userId, record.vaultId),
  );
}

export async function getAssistantCredential(
  userId: string,
  vaultId: string,
): Promise<CachedAssistantCredentialRecord | null> {
  const db = await openOfflineDb();
  return (
    (await db.get("ai_credentials", assistantCredentialKey(userId, vaultId))) ??
    null
  );
}

export async function deleteAssistantCredential(
  userId: string,
  vaultId: string,
): Promise<void> {
  const db = await openOfflineDb();
  await db.delete("ai_credentials", assistantCredentialKey(userId, vaultId));
}

export async function putAssistantConversations(
  record: CachedAssistantConversationsRecord,
): Promise<void> {
  const db = await openOfflineDb();
  await db.put(
    "ai_conversations",
    record,
    assistantConversationsKey(record.userId, record.vaultId),
  );
}

export async function putVaultPreferences(
  record: CachedVaultPreferencesRecord,
): Promise<void> {
  const db = await openOfflineDb();
  await db.put(
    "vault_preferences",
    record,
    vaultPreferencesKey(record.userId, record.vaultId),
  );
}

export async function getVaultPreferences(
  userId: string,
  vaultId: string,
): Promise<CachedVaultPreferencesRecord | null> {
  const db = await openOfflineDb();
  return (
    (await db.get("vault_preferences", vaultPreferencesKey(userId, vaultId))) ??
    null
  );
}

export async function getAssistantConversations(
  userId: string,
  vaultId: string,
): Promise<CachedAssistantConversationsRecord | null> {
  const db = await openOfflineDb();
  return (
    (await db.get(
      "ai_conversations",
      assistantConversationsKey(userId, vaultId),
    )) ?? null
  );
}

export async function listCachedVaultIds(userId: string): Promise<string[]> {
  const db = await openOfflineDb();
  const envelopes = await db.getAll("envelopes");
  return [
    ...new Set(
      envelopes
        .filter((row) => row.userId === userId)
        .map((row) => row.vaultId),
    ),
  ];
}

export async function setCachedPullCursor(
  userId: string,
  vaultId: string,
  cursor: string | null,
): Promise<void> {
  const db = await openOfflineDb();
  const key = metaKey(userId, "cursor", vaultId);
  await db.put("meta", { key, value: cursor }, key);
}

export async function getCachedPullCursor(
  userId: string,
  vaultId: string,
): Promise<string | null> {
  const db = await openOfflineDb();
  const row = await db.get("meta", metaKey(userId, "cursor", vaultId));
  return typeof row?.value === "string" ? row.value : null;
}

export async function setCachedHeadRevision(
  userId: string,
  vaultId: string,
  revision: number,
): Promise<void> {
  const db = await openOfflineDb();
  const key = metaKey(userId, "head", vaultId);
  await db.put("meta", { key, value: revision }, key);
}

export async function getCachedHeadRevision(
  userId: string,
  vaultId: string,
): Promise<number> {
  const db = await openOfflineDb();
  const row = await db.get("meta", metaKey(userId, "head", vaultId));
  return typeof row?.value === "number" ? row.value : 0;
}

export async function rememberSessionUser(userId: string): Promise<void> {
  const db = await openOfflineDb();
  const key = metaKey(userId, "session-user");
  await db.put("meta", { key, value: userId }, key);
}

export async function getRememberedSessionUser(): Promise<string | null> {
  const db = await openOfflineDb();
  const all = await db.getAll("meta");
  const hit = all.find(
    (row) =>
      typeof row.key === "string" &&
      row.key.startsWith("session:") &&
      typeof row.value === "string",
  );
  return typeof hit?.value === "string" ? hit.value : null;
}

export async function clearRememberedSession(): Promise<void> {
  const db = await openOfflineDb();
  const allKeys = await db.getAllKeys("meta");
  await Promise.all(
    allKeys
      .filter((key) => String(key).startsWith("session:"))
      .map((key) => db.delete("meta", key)),
  );
}

export async function putNoteRevision(
  record: CachedRevisionRecord,
): Promise<void> {
  const db = await openOfflineDb();
  const key = revisionKey(
    record.userId,
    record.vaultId,
    record.noteId,
    record.revision,
  );
  const tx = db.transaction("note_revisions", "readwrite");
  try {
    await tx.store.put(record, key);
    // Legacy revisions and named restore-point targets are user data; only the
    // recovery-snapshot writer may expire records it explicitly owns.
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
    await tx.done.catch(() => {});
    throw error;
  }
}

export async function listNoteRevisions(
  userId: string,
  vaultId: string,
  noteId: string,
): Promise<CachedRevisionRecord[]> {
  const db = await openOfflineDb();
  const prefix = `${userId}:${vaultId}:${noteId}:`;
  const all = await db.getAll(
    "note_revisions",
    IDBKeyRange.bound(prefix, `${prefix}\uffff`),
  );
  return all
    .filter(
      (row) =>
        row.userId === userId &&
        row.vaultId === vaultId &&
        row.noteId === noteId,
    )
    .sort((left, right) => right.revision - left.revision);
}

export async function clearUserOfflineData(userId: string): Promise<void> {
  const db = await openOfflineDb();
  const prefix = `${userId}:`;

  for (const store of [
    "notes",
    "envelopes",
    "trusted_devices",
    "ai_credentials",
    "ai_conversations",
    "vault_preferences",
    "note_revisions",
  ] as const) {
    const keys = await db.getAllKeys(store);
    await Promise.all(
      keys
        .filter((key) => String(key).startsWith(prefix))
        .map((key) => db.delete(store, key)),
    );
  }

  const queued = await db.getAll("queue");
  await Promise.all(
    queued
      .filter((row) => row.userId === userId)
      .map((row) => db.delete("queue", row.operation_id)),
  );

  const metaKeys = await db.getAllKeys("meta");
  await Promise.all(
    metaKeys
      .filter(
        (key) =>
          String(key).startsWith(prefix) || String(key) === `session:${userId}`,
      )
      .map((key) => db.delete("meta", key)),
  );
}

/** Logout forgets automatic unlocking, not encrypted user work. */
export async function clearUserUnlockMaterial(userId: string): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction(
    ["trusted_devices", "ai_credentials", "meta"],
    "readwrite",
  );
  for (const store of ["trusted_devices", "ai_credentials"] as const) {
    const keys = await tx.objectStore(store).getAllKeys();
    for (const key of keys)
      if (String(key).startsWith(`${userId}:`))
        await tx.objectStore(store).delete(key);
  }
  await tx.objectStore("meta").delete(`session:${userId}`);
  await tx.done;
}

/** Commit a pulled page and its cursor together, preserving queued local variants. */
export async function commitPulledPage(
  userId: string,
  vaultId: string,
  operations: import("@synapse/api-client").EncryptedPushOperation[],
  cursor: string | null,
): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction(["notes", "queue", "meta"], "readwrite");
  try {
    const pending = new Set(
      (await tx.objectStore("queue").getAll())
        .filter(
          (row) =>
            row.userId === userId &&
            row.vault_id === vaultId &&
            !row.supersededBy,
        )
        .map((row) => row.note_id),
    );
    for (const operation of operations) {
      if (!pending.has(operation.note_id))
        await tx.objectStore("notes").put(
          {
            userId,
            vaultId,
            noteId: operation.note_id,
            ciphertext: operation.ciphertext,
            ciphertextHash: operation.ciphertext_hash,
            nonce: operation.nonce,
            revision: operation.base_revision,
          },
          noteKey(userId, vaultId, operation.note_id),
        );
    }
    const headKey = metaKey(userId, "head", vaultId);
    const previous = await tx.objectStore("meta").get(headKey);
    const head = Math.max(
      typeof previous?.value === "number" ? previous.value : 0,
      ...operations.map((operation) => operation.base_revision + 1),
    );
    await tx.objectStore("meta").put({ key: headKey, value: head }, headKey);
    if (cursor !== null) {
      const key = metaKey(userId, "cursor", vaultId);
      await tx.objectStore("meta").put({ key, value: cursor }, key);
    }
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
}
