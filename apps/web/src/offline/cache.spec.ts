import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearUserOfflineData,
  closeOfflineDb,
  deleteAssistantCredential,
  getAssistantCredential,
  getAssistantConversations,
  getCachedEnvelope,
  getCachedHeadRevision,
  getTrustedDevice,
  listCachedNotes,
  openOfflineDb,
  putAssistantCredential,
  putAssistantConversations,
  putCachedEnvelope,
  putCachedNote,
  putTrustedDevice,
  resetOfflineDbHandle,
  setCachedHeadRevision,
  setCachedPullCursor,
  deleteTrustedDevice,
} from "./cache";

const userId = "0198e5de-user-7000-8000-000000000001";
const vaultId = "0198e5de-1111-7222-8333-444455556666";
const noteId = "0198e5de-7777-7888-8999-aaaabbbbcccc";
const plaintext = "# Secret offline note";
const offlineDbName = "synapse-offline-v1";

function deleteOfflineDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(offlineDbName);
    request.onblocked = () => reject(new Error("offline database is still open"));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

function createLegacyEncryptedCache(
  version: number,
  ciphertext: number[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(offlineDbName, version);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of ["notes", "envelopes", "meta", "queue"]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
      request.transaction?.objectStore("notes").put(
        {
          ciphertext,
          ciphertextHash: "ab".repeat(32),
          nonce: Array.from({ length: 24 }, (_, index) => index),
          noteId,
          revision: 1,
          userId,
          vaultId,
        },
        `${userId}:${vaultId}:${noteId}`,
      );
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
}

describe("offline cache", () => {
  beforeEach(async () => {
    await closeOfflineDb();
    await deleteOfflineDb();
    resetOfflineDbHandle();
  });

  it("persists only ciphertexts, envelopes, cursor and never plaintext Markdown", async () => {
    await putCachedEnvelope(userId, vaultId, [1, 2, 3, 4]);
    await putCachedNote(userId, {
      ciphertext: [9, 8, 7, 6, 5],
      ciphertextHash: "ab".repeat(32),
      nonce: Array.from({ length: 24 }, (_, i) => i),
      noteId,
      revision: 1,
      vaultId,
    });
    await setCachedPullCursor(userId, vaultId, "cursor-1");
    await setCachedHeadRevision(userId, vaultId, 1);

    const notes = await listCachedNotes(userId, vaultId);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.ciphertext).toEqual([9, 8, 7, 6, 5]);
    expect(await getCachedEnvelope(userId, vaultId)).toEqual([1, 2, 3, 4]);
    expect(await getCachedHeadRevision(userId, vaultId)).toBe(1);

    const db = await openOfflineDb();
    const dumped = JSON.stringify({
      ai_credentials: await db.getAll("ai_credentials"),
      envelopes: await db.getAll("envelopes"),
      meta: await db.getAll("meta"),
      notes: await db.getAll("notes"),
      queue: await db.getAll("queue"),
    });
    expect(dumped).not.toContain(plaintext);
    expect(dumped).not.toContain("Secret offline");
    expect(dumped).not.toContain("# ");
  });

  it.each([1, 2, 3, 4, 5, 6])(
    "migrates encrypted notes from schema version %i without exposing plaintext",
    async (version) => {
      await closeOfflineDb();
      await deleteOfflineDb();
      const ciphertext = Array.from(
        { length: 24 },
        (_, index) => (version * 37 + index * 19) % 256,
      );
      await createLegacyEncryptedCache(version, ciphertext);
      resetOfflineDbHandle();

      const notes = await listCachedNotes(userId, vaultId);
      const db = await openOfflineDb();

      expect(notes).toEqual([
        expect.objectContaining({ ciphertext, noteId, revision: 1 }),
      ]);
      expect(Array.from(db.objectStoreNames)).toEqual(
        expect.arrayContaining([
          "ai_conversations",
          "ai_credentials",
          "envelopes",
          "meta",
          "note_revisions",
          "notes",
          "queue",
          "trusted_devices",
          "vault_preferences",
        ]),
      );
      expect(JSON.stringify(await db.getAll("notes"))).not.toContain(
        plaintext,
      );
    },
  );

  it("keeps ciphertexts after clear of another user partition", async () => {
    await putCachedNote(userId, {
      ciphertext: [1],
      ciphertextHash: "cd".repeat(32),
      nonce: Array.from({ length: 24 }, () => 0),
      noteId,
      revision: 0,
      vaultId,
    });
    await clearUserOfflineData("0198e5de-other-7000-8000-000000000099");
    expect(await listCachedNotes(userId, vaultId)).toHaveLength(1);
  });

  it("stores and removes trusted device envelopes without plaintext keys", async () => {
    const wrappingKey = await crypto.subtle.generateKey(
      { length: 256, name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    const record = {
      ciphertext: [9, 8, 7],
      iv: Array.from({ length: 12 }, () => 1),
      userId,
      vaultId,
      wrappingKey,
    };

    await putTrustedDevice(record);
    const stored = await getTrustedDevice(userId, vaultId);
    expect(stored?.ciphertext).toEqual(record.ciphertext);
    expect(stored?.iv).toEqual(record.iv);
    expect(stored?.wrappingKey.extractable).toBe(false);

    const db = await openOfflineDb();
    expect(JSON.stringify(await db.getAll("trusted_devices"))).not.toContain(
      "Secret offline",
    );

    await deleteTrustedDevice(record);
    expect(await getTrustedDevice(userId, vaultId)).toBeNull();
  });

  it("stores assistant credentials as ciphertext only", async () => {
    const token = "sk-live-super-secret";
    await putAssistantCredential({
      ciphertext: [3, 1, 4],
      nonce: Array.from({ length: 24 }, (_, index) => index),
      provider: "codex",
      userId,
      vaultId,
    });

    const stored = await getAssistantCredential(userId, vaultId);
    expect(stored?.ciphertext).toEqual([3, 1, 4]);
    expect(stored?.provider).toBe("codex");

    const db = await openOfflineDb();
    const dumped = JSON.stringify(await db.getAll("ai_credentials"));
    expect(dumped).not.toContain(token);
    expect(dumped).not.toContain("Secret offline");

    await deleteAssistantCredential(userId, vaultId);
    expect(await getAssistantCredential(userId, vaultId)).toBeNull();
  });

  it("stores assistant conversations as ciphertext only and clears them by user", async () => {
    await putAssistantConversations({
      ciphertext: [7, 2, 9],
      nonce: Array.from({ length: 24 }, (_, index) => index),
      userId,
      vaultId,
    });

    expect(
      (await getAssistantConversations(userId, vaultId))?.ciphertext,
    ).toEqual([7, 2, 9]);
    const db = await openOfflineDb();
    expect(JSON.stringify(await db.getAll("ai_conversations"))).not.toContain(
      "Secret offline",
    );

    await clearUserOfflineData(userId);
    expect(await getAssistantConversations(userId, vaultId)).toBeNull();
  });
});
