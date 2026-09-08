import "fake-indexeddb/auto";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearUserOfflineData } from "../offline/cache";
import { useAuthStore } from "./auth";
import { useVaultStore } from "./vault";
const id = "0198e5de-1111-7222-8333-444455556666";
const note = "0198e5de-7777-7888-8999-aaaabbbbcccc";
const key = new Uint8Array(32).fill(7);
beforeEach(async () => {
  setActivePinia(createPinia());
  await clearUserOfflineData("local-device");
  await useAuthStore().enterLocalMode();
  useVaultStore().unlock(key, id);
});
afterEach(() => {
  useVaultStore().lock();
  vi.restoreAllMocks();
});
it("opens current ciphertexts without materializing every note's revision history", async () => {
  const vault = useVaultStore();
  await vault.saveNote({ id: note, path: "note.md", content: "first" });
  await vault.saveNote({ id: note, path: "note.md", content: "second" });
  vault.lock();
  vault.unlock(key, id);
  const reads = vi.spyOn(IDBObjectStore.prototype, "getAll");
  await vault.loadNotes(id);
  expect(vault.notes.get(note)?.content).toBe("second");
  expect(vault.historyFor(note)).toEqual([]);
  expect(
    reads.mock.contexts.filter(
      (store) =>
        store instanceof IDBObjectStore && store.name === "note_revisions",
    ),
  ).toHaveLength(0);
  await vault.loadHistory(note);
  expect(vault.historyFor(note).map((row) => row.content)).toEqual([
    "second",
    "first",
  ]);
  expect(
    reads.mock.contexts.filter(
      (store) =>
        store instanceof IDBObjectStore && store.name === "note_revisions",
    ),
  ).toHaveLength(1);
  vault.lock();
  expect(vault.historyFor(note)).toEqual([]);
});

it("creates a restore point after reopening and restores its actual durable history revision", async () => {
  const vault = useVaultStore();
  await vault.saveNote({ id: note, path: "note.md", content: "bookmarked" });
  vault.lock();
  vault.unlock(key, id);
  await vault.loadNotes(id);
  await vault.createRestorePoint(note, "before change");
  const point = vault.restorePointsFor(note)[0]!;
  await vault.saveNote({ id: note, path: "note.md", content: "changed" });
  await vault.restoreRevision(note, point.revision);
  expect(vault.notes.get(note)?.content).toBe("bookmarked");
});

it("does not restore into a different unlocked vault while history is loading", async () => {
  const cache = await import("../offline/cache");
  const vault = useVaultStore();
  await vault.saveNote({ id: note, path: "note.md", content: "original" });
  const original = cache.listNoteRevisions;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(cache, "listNoteRevisions").mockImplementation(async (...args) => {
    await pending;
    return original(...args);
  });
  const restoring = vault.restoreRevision(note, 1);
  const rejected = expect(restoring).rejects.toThrow("Vault is locked");
  vault.lock();
  vault.unlock(
    new Uint8Array(32).fill(9),
    "0198e5de-1111-7222-8333-444455557777",
  );
  vault.notes.set(note, {
    content: "other vault",
    revision: 1,
    path: "other.md",
  });
  release();
  await rejected;
  expect(vault.notes.get(note)?.content).toBe("other vault");
});
