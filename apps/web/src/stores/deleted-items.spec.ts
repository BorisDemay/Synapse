import "fake-indexeddb/auto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clearUserOfflineData,
  getCachedEnvelope,
  openOfflineDb,
  putCachedNote,
} from "../offline/cache";
import { listPendingOperations } from "../offline/queue";
import { useAuthStore } from "./auth";
import { useVaultStore } from "./vault";

const user = "local-device";
const vaultId = "0198e5de-1111-7222-8333-444455556666";
const note = "0198e5de-7777-7888-8999-aaaabbbbcccc";
const other = "0198e5de-7777-7888-8999-aaaabbbbdddd";
const attachment = "0198e5de-7777-7888-8999-aaaabbbbeeee";
const passphrase = "local passphrase test";

beforeEach(async () => {
  await clearUserOfflineData(user);
  setActivePinia(createPinia());
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no server")));
});
afterEach(() => {
  useVaultStore().lock();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function reopenLocalVault(id: string) {
  const auth = useAuthStore();
  const { parseWrappedVaultKey, unlockVaultKey } = await import(
    "../crypto/vault-key"
  );
  const envelope = await getCachedEnvelope(auth.userId!, id);
  const key = await unlockVaultKey(parseWrappedVaultKey(envelope!), passphrase);
  const vault = useVaultStore();
  vault.lock();
  vault.unlock(key, id);
  await vault.loadNotes(id);
  return vault;
}

it("restores a deleted local note at its exact path and content after reopening", async () => {
  const auth = useAuthStore();
  await auth.enterLocalMode();
  const vault = useVaultStore();
  const id = await vault.createAndUnlockVault(passphrase);
  await vault.saveNote({
    id: note,
    path: "notes/idea.md",
    content: "# Secret plan",
  });
  await vault.deleteNote(note);
  expect(vault.notes.has(note)).toBe(false);

  await reopenLocalVault(id);

  const rows = await vault.listDeletedItems();
  expect(rows).toEqual([
    {
      id: note,
      label: "Secret plan",
      path: "notes/idea.md",
      kind: "note",
      recoverable: true,
    },
  ]);

  await vault.restoreDeletedItem(note);
  expect(vault.notes.get(note)).toMatchObject({
    content: "# Secret plan",
    path: "notes/idea.md",
  });
  expect(await vault.listDeletedItems()).toEqual([]);
});

it("restores a deleted attachment with the same id, path and bytes", async () => {
  const auth = useAuthStore();
  await auth.enterLocalMode();
  const vault = useVaultStore();
  const id = await vault.createAndUnlockVault(passphrase);
  const bytes = new Uint8Array([1, 2, 3, 4, 250]);
  await vault.saveAttachment({
    id: attachment,
    path: "attachments/report.bin",
    contentType: "application/octet-stream",
    bytes,
  });
  await vault.deleteNote(attachment);
  expect(vault.attachments.has(attachment)).toBe(false);

  await reopenLocalVault(id);

  const rows = await vault.listDeletedItems();
  expect(rows).toEqual([
    {
      id: attachment,
      label: "attachments/report.bin",
      path: "attachments/report.bin",
      kind: "attachment",
      recoverable: true,
    },
  ]);

  await vault.restoreDeletedItem(attachment);
  const restored = vault.attachments.get(attachment);
  expect(restored?.path).toBe("attachments/report.bin");
  expect(restored?.contentType).toBe("application/octet-stream");
  expect(Array.from(restored?.bytes ?? [])).toEqual([1, 2, 3, 4, 250]);
});

it("returns a generic nonrecoverable row when local history is unavailable", async () => {
  await useAuthStore().enterLocalMode();
  const key = new Uint8Array(32).fill(3);
  const vault = useVaultStore();
  vault.unlock(key, vaultId);

  const nonce = new Uint8Array(24).fill(5);
  const plaintext = new TextEncoder().encode("\u0000synapse/deleted");
  const aad = new TextEncoder().encode(`synapse/aad/1/${vaultId}/${note}/0`);
  const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
  await putCachedNote(user, {
    vaultId,
    noteId: note,
    revision: 0,
    ciphertext: Array.from(ciphertext),
    ciphertextHash: "a".repeat(64),
    nonce: Array.from(nonce),
  });

  const reads = vi.spyOn(IDBObjectStore.prototype, "getAll");
  const rows = await vault.listDeletedItems();
  expect(rows).toEqual([
    {
      id: note,
      label: "Élément supprimé",
      path: "",
      kind: "note",
      recoverable: false,
    },
  ]);
  // The lazy scan reads history only for the tombstone found in the cache.
  expect(
    reads.mock.contexts.filter(
      (store) =>
        store instanceof IDBObjectStore && store.name === "note_revisions",
    ),
  ).toHaveLength(1);
  await expect(vault.restoreDeletedItem(note)).rejects.toThrow(
    "No recoverable history for this item",
  );
  expect(vault.notes.has(note)).toBe(false);
});

it("never scans note histories when nothing is deleted", async () => {
  await useAuthStore().enterLocalMode();
  const vault = useVaultStore();
  const id = await vault.createAndUnlockVault(passphrase);
  await vault.saveNote({ id: note, path: "live.md", content: "alive" });

  await reopenLocalVault(id);

  const reads = vi.spyOn(IDBObjectStore.prototype, "getAll");
  expect(await vault.listDeletedItems()).toEqual([]);
  expect(
    reads.mock.contexts.filter(
      (store) =>
        store instanceof IDBObjectStore && store.name === "note_revisions",
    ),
  ).toHaveLength(0);
});

it("keeps offline delete and restore as normal pending operations without plaintext at rest", async () => {
  const auth = useAuthStore();
  auth.userId = user;
  auth.isAuthenticated = true;
  const vault = useVaultStore();
  vault.unlock(new Uint8Array(32).fill(4), vaultId);
  await vault.saveNote({
    id: note,
    path: "doc.md",
    content: "plain secret body",
  });
  await vault.flushPendingOperations();
  await vault.deleteNote(note);
  await vault.restoreDeletedItem(note);

  expect(vault.notes.get(note)).toMatchObject({
    content: "plain secret body",
    path: "doc.md",
  });
  const pending = await listPendingOperations(user, vaultId);
  // The initial save, the tombstone and the restoration stay queued in order;
  // none is erased or superseded by the restore.
  expect(pending).toHaveLength(3);
  expect(pending.map((operation) => operation.note_id)).toEqual([
    note,
    note,
    note,
  ]);

  const db = await openOfflineDb();
  const queue = await db.getAll("queue");
  expect(queue).toHaveLength(3);
  expect(queue.every((row) => !row.supersededBy)).toBe(true);
  const dump = JSON.stringify({
    notes: await db.getAll("notes"),
    queue: await db.getAll("queue"),
    revisions: await db.getAll("note_revisions"),
  });
  expect(dump).not.toContain("plain secret body");
  expect(dump).not.toContain("doc.md");
  // History is never erased by a restore: both the tombstone and the
  // pre-deletion content remain durable encrypted revisions.
  const revisions = (await db.getAll("note_revisions")).filter(
    (row) => row.noteId === note,
  );
  expect(revisions).toHaveLength(3);
});

it("refuses to resurrect an item that is no longer deleted", async () => {
  const auth = useAuthStore();
  auth.userId = user;
  auth.isAuthenticated = true;
  const vault = useVaultStore();
  vault.unlock(new Uint8Array(32).fill(4), vaultId);
  await vault.saveNote({ id: note, path: "doc.md", content: "live" });
  await expect(vault.restoreDeletedItem(note)).rejects.toThrow(
    "Item is no longer deleted",
  );
  await vault.deleteNote(note);
  await vault.restoreDeletedItem(note);
  await expect(vault.restoreDeletedItem(note)).rejects.toThrow(
    "Item is no longer deleted",
  );
  expect(vault.notes.get(note)?.content).toBe("live");
});

it("does not overwrite an item restored or moved while history is loading", async () => {
  await useAuthStore().enterLocalMode();
  const vault = useVaultStore();
  vault.unlock(new Uint8Array(32).fill(4), vaultId);
  await vault.saveNote({ id: note, path: "old.md", content: "old revision" });
  await vault.deleteNote(note);
  const cache = await import("../offline/cache");
  const original = cache.listNoteRevisions;
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(cache, "listNoteRevisions").mockImplementationOnce(
    async (...args) => {
      const records = await original(...args);
      entered();
      await hold;
      return records;
    },
  );
  const restoring = vault.restoreDeletedItem(note);
  const rejected = expect(restoring).rejects.toThrow(
    "Item is no longer deleted",
  );
  await started;
  await vault.saveNote({
    id: note,
    path: "moved.md",
    content: "newer live revision",
  });
  release();
  await rejected;
  expect(vault.notes.get(note)).toMatchObject({
    path: "moved.md",
    content: "newer live revision",
  });
});

it("refuses to restore over a path held by another live item", async () => {
  const auth = useAuthStore();
  auth.userId = user;
  auth.isAuthenticated = true;
  const vault = useVaultStore();
  vault.unlock(new Uint8Array(32).fill(4), vaultId);
  await vault.saveNote({
    id: note,
    path: "notes/idea.md",
    content: "original",
  });
  await vault.deleteNote(note);
  await vault.saveNote({
    id: other,
    path: "notes/idea.md",
    content: "replacement",
  });
  await expect(vault.restoreDeletedItem(note)).rejects.toThrow(
    "Path already in use",
  );
  expect(vault.notes.get(note)).toBeUndefined();
  expect(vault.notes.get(other)?.content).toBe("replacement");
});

it("aborts a restore that races a lock or account switch without touching the new vault", async () => {
  const auth = useAuthStore();
  auth.userId = user;
  auth.isAuthenticated = true;
  const vault = useVaultStore();
  vault.unlock(new Uint8Array(32).fill(4), vaultId);
  await vault.saveNote({
    id: note,
    path: "doc.md",
    content: "race secret",
  });
  await vault.deleteNote(note);

  const cache = await import("../offline/cache");
  const original = cache.listNoteRevisions;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(cache, "listNoteRevisions").mockImplementation(async (...args) => {
    await pending;
    return original(...args);
  });
  const restoring = vault.restoreDeletedItem(note);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  vault.lock();
  vault.unlock(
    new Uint8Array(32).fill(9),
    "0198e5de-1111-7222-8333-444455557777",
  );
  vault.notes.set(note, { content: "other vault note", revision: 0 });
  release();
  await expect(restoring).rejects.toThrow("Vault is locked");
  expect(vault.notes.get(note)?.content).toBe("other vault note");
});
