import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearUserOfflineData,
  getCachedEnvelope,
  getCachedHeadRevision,
  listCachedNotes,
  openOfflineDb,
  putCachedEnvelope,
  putCachedNote,
  resetOfflineDbHandle,
  setCachedHeadRevision,
  setCachedPullCursor,
} from "./cache";

const userId = "0198e5de-user-7000-8000-000000000001";
const vaultId = "0198e5de-1111-7222-8333-444455556666";
const noteId = "0198e5de-7777-7888-8999-aaaabbbbcccc";
const plaintext = "# Secret offline note";

describe("offline cache", () => {
  beforeEach(async () => {
    resetOfflineDbHandle();
    indexedDB.deleteDatabase("synapse-offline-v1");
    resetOfflineDbHandle();
    await clearUserOfflineData(userId);
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
      envelopes: await db.getAll("envelopes"),
      meta: await db.getAll("meta"),
      notes: await db.getAll("notes"),
      queue: await db.getAll("queue"),
    });
    expect(dumped).not.toContain(plaintext);
    expect(dumped).not.toContain("Secret offline");
    expect(dumped).not.toContain("# ");
  });

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
});
