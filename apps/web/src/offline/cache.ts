import {
  assistantConversationsKey,
  assistantCredentialKey,
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

export { openOfflineDb, resetOfflineDbHandle };

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
  const all = await db.getAll("notes");
  return all.filter(
    (note) =>
      note.userId === userId &&
      note.vaultId === vaultId &&
      noteKey(userId, vaultId, note.noteId).startsWith(prefix),
  );
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
  await db.put("note_revisions", record, key);
  const all = (await db.getAll("note_revisions"))
    .filter(
      (row) =>
        row.userId === record.userId &&
        row.vaultId === record.vaultId &&
        row.noteId === record.noteId,
    )
    .sort((left, right) => right.revision - left.revision);
  await Promise.all(
    all
      .slice(50)
      .map((row) =>
        db.delete(
          "note_revisions",
          revisionKey(row.userId, row.vaultId, row.noteId, row.revision),
        ),
      ),
  );
}

export async function listNoteRevisions(
  userId: string,
  vaultId: string,
  noteId: string,
): Promise<CachedRevisionRecord[]> {
  const db = await openOfflineDb();
  const all = await db.getAll("note_revisions");
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
