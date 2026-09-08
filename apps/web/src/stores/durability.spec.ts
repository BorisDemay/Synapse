import "fake-indexeddb/auto";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  clearUserOfflineData,
  listCachedNotes,
  putCachedEnvelope,
  getCachedEnvelope,
} from "../offline/cache";
import { listPendingOperations } from "../offline/queue";
import { useAuthStore } from "./auth";
import { useVaultStore } from "./vault";
const user = "durability-user";
const vaultId = "0198e5de-1111-7222-8333-444455556666";
const note = "0198e5de-7777-7888-8999-aaaabbbbcccc";
beforeEach(async () => {
  await clearUserOfflineData(user);
  setActivePinia(createPinia());
  useAuthStore().userId = user;
  useAuthStore().isAuthenticated = true;
  useVaultStore().unlock(new Uint8Array(32), vaultId);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(async () => {
  useVaultStore().lock();
  await useVaultStore().flushPendingOperations();
  vi.unstubAllGlobals();
});
it("commits ciphertext and outbox and returns while the network hangs", async () => {
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  const result = await Promise.race([
    useVaultStore().saveNote({ id: note, content: "durable secret" }),
    new Promise((resolve) => setTimeout(() => resolve("blocked"), 100)),
  ]);
  expect(result).not.toBe("blocked");
  expect(await listPendingOperations(user, vaultId)).toHaveLength(1);
  expect(await listCachedNotes(user, vaultId)).toHaveLength(1);
});
it("retains a refused HTTP operation", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
  await useVaultStore().saveNote({ id: note, content: "durable secret" });
  await useVaultStore().flushPendingOperations();
  expect(await listPendingOperations(user, vaultId)).toHaveLength(1);
});
it("rejects mismatched acknowledgements", async () => {
  vi.mocked(fetch).mockImplementation(
    async () =>
      new Response(JSON.stringify({ operation_id: "wrong", revision: 1 })),
  );
  await useVaultStore().saveNote({ id: note, content: "durable secret" });
  await useVaultStore().flushPendingOperations();
  expect(await listPendingOperations(user, vaultId)).toHaveLength(1);
});
it("logout retains recoverable ciphertext and envelope but clears plaintext", async () => {
  vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
  await putCachedEnvelope(user, vaultId, [1, 2, 3]);
  await useVaultStore().saveNote({ id: note, content: "durable secret" });
  await useAuthStore()
    .logout()
    .catch(() => {});
  expect(await listPendingOperations(user, vaultId)).toHaveLength(1);
  expect(await getCachedEnvelope(user, vaultId)).toEqual([1, 2, 3]);
  expect(useVaultStore().notes.size).toBe(0);
  expect(useVaultStore().isUnlocked).toBe(false);
});
it("serializes flush callers and preserves newer cached ciphertext when the first ack arrives", async () => {
  let release!: (value: Response) => void;
  let firstId = "";
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    const operation = JSON.parse(String(init?.body));
    if (firstId)
      return new Response(
        JSON.stringify({ operation_id: operation.operation_id, revision: 2 }),
      );
    firstId = operation.operation_id;
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });
  const vault = useVaultStore();
  await vault.saveNote({ id: note, content: "first" });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await vault.saveNote({ id: note, content: "second" });
  const a = vault.flushPendingOperations();
  const b = vault.flushPendingOperations();
  expect(fetch).toHaveBeenCalledTimes(1);
  release(new Response(JSON.stringify({ operation_id: firstId, revision: 1 })));
  await Promise.all([a, b]);
  expect(
    (await listCachedNotes(user, vaultId))[0]?.ciphertextHash,
  ).not.toBeUndefined();
  expect(vault.notes.get(note)?.content).toBe("second");
  expect(await listPendingOperations(user, vaultId)).toHaveLength(0);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vault.historyFor(note).map((row) => row.content)).toEqual([
    "second",
    "first",
  ]);
});
it("replays an attempted request unchanged after an unknown network outcome", async () => {
  const sent: string[] = [];
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    sent.push(String(init?.body));
    throw new TypeError("connection lost after commit");
  });
  const vault = useVaultStore();
  await vault.saveNote({ id: note, content: "first" });
  await vault.flushPendingOperations();
  await vault.flushPendingOperations();
  expect(sent).toHaveLength(2);
  expect(sent[0]).toBe(sent[1]);
});
it("advances only local dependent operations after their predecessor is acknowledged", async () => {
  vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
  const vault = useVaultStore();
  await vault.saveNote({ id: note, content: "first" });
  await vault.flushPendingOperations();
  await vault.saveNote({ id: note, content: "second" });
  await vault.flushPendingOperations();
  // The first is attempted; the second has never reached the network.
  const sent: Array<{ operation_id: string; base_revision: number }> = [];
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    const operation = JSON.parse(String(init?.body));
    sent.push(operation);
    return new Response(
      JSON.stringify({
        operation_id: operation.operation_id,
        revision: sent.length,
      }),
    );
  });
  await vault.flushPendingOperations();
  expect(sent.map((row) => row.base_revision)).toEqual([0, 1]);
  expect(await listPendingOperations(user, vaultId)).toHaveLength(0);
});

it("a delayed old logout cannot clear a newly logged-in account", async () => {
  let release!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(
    async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const auth = useAuthStore();
  const logout = auth.logout();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  auth.userId = "another-account";
  auth.isAuthenticated = true;
  release(new Response(null, { status: 204 }));
  await logout;
  expect(auth.userId).toBe("another-account");
  expect(auth.isAuthenticated).toBe(true);
});

it("a resolution supersedes all pending variants it covers without erasing their ciphertext", async () => {
  vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
  const vault = useVaultStore();
  const first = await vault.saveNote({ id: note, content: "first" });
  await vault.flushPendingOperations();
  await vault.saveNote({ id: note, content: "second" });
  await vault.flushPendingOperations();
  vault.activeConflict = {
    base: "",
    local: "second",
    manualDraft: "second",
    noteId: note,
    remote: "remote",
    conflict: {
      protocol_version: 1,
      operation_id: first.operation_id,
      vault_id: vaultId,
      note_id: note,
      base_revision: 0,
      remote_revision: 1,
      base_ciphertext_hash: "0".repeat(64),
      local_ciphertext_hash: first.ciphertext_hash,
      remote_ciphertext_hash: "a".repeat(64),
    },
  };
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    const operation = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ operation_id: operation.operation_id, revision: 2 }),
    );
  });
  await vault.resolveConflict("resolved");
  await vault.flushPendingOperations();
  expect(await listPendingOperations(user, vaultId)).toHaveLength(0);
  const { openOfflineDb } = await import("../offline/cache");
  const old = await (await openOfflineDb()).get("queue", first.operation_id);
  expect(old?.ciphertext).toEqual(first.ciphertext);
  expect(old?.supersededBy).toBeTruthy();
  expect(vault.notes.get(note)?.content).toBe("resolved");
});

it("keeps the conflict visible when durable resolution storage fails", async () => {
  const queue = await import("../offline/queue");
  const vault = useVaultStore();
  const conflict = {
    base: "",
    local: "local",
    manualDraft: "local",
    noteId: note,
    remote: "remote",
    conflict: {
      protocol_version: 1 as const,
      operation_id: "old",
      vault_id: vaultId,
      note_id: note,
      base_revision: 0,
      remote_revision: 1,
      base_ciphertext_hash: "0".repeat(64),
      local_ciphertext_hash: "b".repeat(64),
      remote_ciphertext_hash: "a".repeat(64),
    },
  };
  vault.activeConflict = conflict;
  const write = vi
    .spyOn(queue, "persistPendingOperation")
    .mockRejectedValueOnce(new Error("quota"));
  await expect(vault.resolveConflict("resolved")).rejects.toThrow("quota");
  expect(vault.activeConflict?.local).toBe("local");
  write.mockRestore();
});

it("an old deletion finishing after vault switch cannot remove the new vault note", async () => {
  const queue = await import("../offline/queue");
  const original = queue.persistPendingOperation;
  let release!: () => void;
  const write = vi
    .spyOn(queue, "persistPendingOperation")
    .mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(...args);
    });
  const vault = useVaultStore();
  const deletion = vault.deleteNote(note);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  vault.lock();
  vault.unlock(new Uint8Array(32).fill(1), "another-vault");
  vault.notes.set(note, { content: "other vault note", revision: 0 });
  release();
  await deletion;
  expect(vault.notes.get(note)?.content).toBe("other vault note");
  write.mockRestore();
});
