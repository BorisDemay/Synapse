import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import {
  clearUserOfflineData,
  listCachedNotes,
  listNoteRevisions,
  openOfflineDb,
  putCachedNote,
  putNoteRevision,
} from "./cache";
const userId = "cache-performance";
const vaultId = "vault-a";
afterEach(async () => {
  vi.restoreAllMocks();
  await clearUserOfflineData(userId);
});
it("bounds ciphertext materialization to the requested vault and note history", async () => {
  for (const vault of [vaultId, "vault-b"]) {
    await putCachedNote(userId, {
      vaultId: vault,
      noteId: "note-a",
      ciphertext: [1],
      nonce: [2],
      ciphertextHash: "hash",
      revision: 0,
    });
    await putNoteRevision({
      userId,
      vaultId: vault,
      noteId: "note-a",
      ciphertext: [1],
      nonce: [2],
      baseRevision: 0,
      revision: 1,
      recordedAt: "today",
    });
  }
  const reads = vi.spyOn(IDBObjectStore.prototype, "getAll");
  expect(await listCachedNotes(userId, vaultId)).toHaveLength(1);
  expect(await listNoteRevisions(userId, vaultId, "note-a")).toHaveLength(1);
  for (const [query] of reads.mock.calls) {
    expect(query).toBeInstanceOf(IDBKeyRange);
    expect((query as IDBKeyRange).includes(`${userId}:vault-b:note-a`)).toBe(
      false,
    );
  }
});
it("prunes only the selected note in the same durable revision transaction", async () => {
  const db = await openOfflineDb();
  const tx = db.transaction("note_revisions", "readwrite");
  for (let revision = 0; revision < 60; revision++) {
    for (const noteId of ["note-a", "note-b"])
      tx.store.put(
        {
          userId,
          vaultId,
          noteId,
          ciphertext: [1],
          nonce: [2],
          baseRevision: 0,
          revision,
          recordedAt: "today",
        },
        `${userId}:${vaultId}:${noteId}:${revision}`,
      );
  }
  await tx.done;
  const reads = vi.spyOn(IDBObjectStore.prototype, "getAll");
  await putNoteRevision({
    userId,
    vaultId,
    noteId: "note-a",
    ciphertext: [1],
    nonce: [2],
    baseRevision: 0,
    revision: 60,
    recordedAt: "today",
  });
  expect(
    reads.mock.calls.every(([query]) => query instanceof IDBKeyRange),
  ).toBe(true);
  expect(
    (await listNoteRevisions(userId, vaultId, "note-a")).map(
      (row) => row.revision,
    ),
  ).toEqual(Array.from({ length: 61 }, (_, i) => 60 - i));
  expect(await listNoteRevisions(userId, vaultId, "note-b")).toHaveLength(60);
});
