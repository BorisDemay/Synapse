import "fake-indexeddb/auto";
import { createPinia, getActivePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearUserOfflineData } from "../offline/cache";
import { listPendingOperations } from "../offline/queue";
import { useAuthStore } from "./auth";
import { useVaultStore } from "./vault";

const user = "synthetic-edit-provenance";
const vaultId = "0198e5de-1111-7222-8333-444455556666";
const note = "0198e5de-7777-7888-8999-aaaabbbbcccc";
const other = "0198e5de-7777-7888-8999-aaaabbbbdddd";
const key = new Uint8Array(32).fill(7);
let serverRevision = 0;
let sentBases: number[] = [];

beforeEach(async () => {
  await clearUserOfflineData(user);
  setActivePinia(createPinia());
  useAuthStore().$patch({ userId: user, isAuthenticated: true });
  useVaultStore().unlock(key, vaultId);
  useVaultStore().setSyncWakeup(() => {});
  serverRevision = 0;
  sentBases = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      if (init?.method !== "POST")
        return new Response(
          JSON.stringify({
            protocol_version: 1,
            operations: [],
            next_cursor: null,
          }),
        );
      const operation = JSON.parse(String(init.body));
      sentBases.push(operation.base_revision);
      if (operation.base_revision !== serverRevision)
        return new Response("{}", { status: 409 });
      serverRevision++;
      return new Response(
        JSON.stringify({
          operation_id: operation.operation_id,
          revision: serverRevision,
        }),
      );
    }),
  );
});
afterEach(() => {
  useVaultStore().lock();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("advances a debounced successor only through the ACK of its visible local predecessor", async () => {
  const vault = useVaultStore();
  await vault.saveNote({ id: note, content: "# First local snapshot" });
  const base = vault.captureNoteEditBase(note);
  expect(base.revision).toBe(0);
  await vault.flushPendingOperations();
  expect(base.revision).toBe(1);
  await vault.saveNote({
    id: note,
    content: "# Continuing snapshot",
    baseRevision: 0,
    editBase: base,
  });
  await vault.flushPendingOperations();
  expect(sentBases).toEqual([0, 1]);
  expect(vault.syncStatus).toBe("synced");
  await vault.loadNotes(vaultId);
  expect(vault.notes.get(note)?.content).toBe("# Continuing snapshot");
});

it("advances continued typing that shares the first autosave's edit base", async () => {
  const vault = useVaultStore();
  const base = vault.captureNoteEditBase(note);
  await vault.saveNote({ id: note, content: "# First", editBase: base });
  await vault.flushPendingOperations();
  await vault.saveNote({
    id: note,
    content: "# Continued",
    baseRevision: 0,
    editBase: base,
  });
  await vault.flushPendingOperations();
  expect(sentBases).toEqual([0, 1]);
});

it("rechecks causal provenance if the predecessor ACK wins the IndexedDB enqueue race", async () => {
  const vault = useVaultStore();
  await vault.saveNote({ id: note, content: "# First" });
  const base = vault.captureNoteEditBase(note);
  const queue = await import("../offline/queue");
  const persist = queue.persistPendingOperation;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(queue, "persistPendingOperation").mockImplementationOnce(
    async (...args) => {
      await gate;
      return persist(...args);
    },
  );
  const saving = vault.saveNote({
    id: note,
    content: "# Newer",
    baseRevision: 0,
    editBase: base,
  });
  await vault.flushPendingOperations();
  expect(base.revision).toBe(1);
  release();
  await saving;
  await vault.flushPendingOperations();
  expect(sentBases).toEqual([0, 1]);
  expect(await listPendingOperations(user, vaultId)).toHaveLength(0);
});

it("retains the queued-predecessor relationship after reopening an offline cached note", async () => {
  const vault = useVaultStore();
  await vault.saveNote({ id: note, content: "# Before restart" });
  vault.lock();
  vault.unlock(key, vaultId);
  await vault.loadNotes(vaultId);
  const base = vault.captureNoteEditBase(note);
  await vault.flushPendingOperations();
  expect(base.revision).toBe(1);
  await vault.saveNote({
    id: note,
    content: "# After restart",
    baseRevision: 0,
    editBase: base,
  });
  await vault.flushPendingOperations();
  expect(sentBases).toEqual([0, 1]);
});

it("does not advance a dirty draft through an independent same-note assistant mutation", async () => {
  const vault = useVaultStore();
  await vault.saveNote({ id: note, content: "# Shared base" });
  await vault.flushPendingOperations();
  const dirtyDraft = vault.captureNoteEditBase(note);
  await vault.saveNote({ id: note, content: "# Independent mutation" });
  await vault.flushPendingOperations();
  expect(dirtyDraft.revision).toBe(1);
  await vault.saveNote({
    id: note,
    content: "# User draft",
    baseRevision: 1,
    editBase: dirtyDraft,
  });
  await vault.flushPendingOperations();
  expect(sentBases).toEqual([0, 1, 1]);
  expect(vault.syncStatus).toBe("conflict");
  expect(await listPendingOperations(user, vaultId)).toHaveLength(1);
});

it("does not advance the edit base when a remote head or a foreign note changes", async () => {
  const vault = useVaultStore();
  const base = vault.captureNoteEditBase(note);
  await vault.saveNote({ id: other, content: "# Other note" });
  await vault.flushPendingOperations();
  vault.headRevision = 8;
  vault.notes.set(note, { content: "# Remote content", revision: 8 });
  expect(base.revision).toBe(0);
  const operation = await vault.saveNote({
    id: note,
    content: "# Old-base draft",
    baseRevision: 0,
    editBase: base,
  });
  expect(operation.base_revision).toBe(0);
});

it("does not skip a remote revision that follows its own valid predecessor ACK", async () => {
  const vault = useVaultStore();
  await vault.saveNote({ id: note, content: "# Local predecessor" });
  const base = vault.captureNoteEditBase(note);
  await vault.flushPendingOperations();
  expect(base.revision).toBe(1);
  serverRevision = 2;
  vault.headRevision = 2;
  vault.notes.set(note, { content: "# Remote change", revision: 2 });
  await vault.saveNote({
    id: note,
    content: "# Continuing old branch",
    baseRevision: 0,
    editBase: base,
  });
  await vault.flushPendingOperations();
  expect(sentBases).toEqual([0, 1]);
  expect(vault.syncStatus).toBe("conflict");
});

it("does not borrow an independent tab's ACK even when it shares IndexedDB", async () => {
  const firstPinia = getActivePinia()!;
  const first = useVaultStore();
  await first.saveNote({ id: note, content: "# Shared base" });
  await first.flushPendingOperations();
  const draft = first.captureNoteEditBase(note);
  setActivePinia(createPinia());
  useAuthStore().$patch({ userId: user, isAuthenticated: true });
  const second = useVaultStore();
  second.unlock(key, vaultId, 1);
  second.setSyncWakeup(() => {});
  await second.saveNote({ id: note, content: "# Other tab branch" });
  await second.flushPendingOperations();
  second.lock();
  setActivePinia(firstPinia);
  expect(draft.revision).toBe(1);
  await first.saveNote({
    id: note,
    content: "# First tab branch",
    editBase: draft,
    baseRevision: 1,
  });
  await first.flushPendingOperations();
  expect(sentBases).toEqual([0, 1, 1]);
  expect(first.syncStatus).toBe("conflict");
});

it("rejects edit bases from another note or an earlier unlock session", async () => {
  const vault = useVaultStore();
  const base = vault.captureNoteEditBase(note);
  await expect(
    vault.saveNote({ id: other, content: "wrong note", editBase: base }),
  ).rejects.toThrow("Invalid edit session");
  vault.lock();
  vault.unlock(key, vaultId);
  await expect(
    vault.saveNote({ id: note, content: "old session", editBase: base }),
  ).rejects.toThrow("Invalid edit session");
  await expect(
    vault.saveNote({ id: note, content: "forged", editBase: { revision: 20 } }),
  ).rejects.toThrow("Invalid edit session");
});
