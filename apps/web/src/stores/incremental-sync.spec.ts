import "fake-indexeddb/auto";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  clearUserOfflineData,
  setCachedPullCursor,
  getCachedPullCursor,
} from "../offline/cache";
import { useAuthStore } from "./auth";
import { useVaultStore } from "./vault";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { encodeNotePlaintext } from "../crypto/vault-item";
const user = "incremental-user";
const vaultId = "0198e5de-1111-7222-8333-444455556666";
const note = "0198e5de-7777-7888-8999-aaaabbbbcccc";
const key = new Uint8Array(32);
function op(content: string, base = 0) {
  const nonce = new Uint8Array(24);
  return {
    protocol_version: 1 as const,
    aad_version: 1 as const,
    operation_id: crypto.randomUUID(),
    vault_id: vaultId,
    note_id: note,
    base_revision: base,
    nonce: [...nonce],
    ciphertext: [
      ...xchacha20poly1305(
        key,
        nonce,
        new TextEncoder().encode(`synapse/aad/1/${vaultId}/${note}/${base}`),
      ).encrypt(encodeNotePlaintext("note.md", content)),
    ],
    ciphertext_hash: "a".repeat(64),
  };
}
beforeEach(async () => {
  await clearUserOfflineData(user);
  setActivePinia(createPinia());
  useAuthStore().userId = user;
  useAuthStore().isAuthenticated = true;
  useVaultStore().unlock(key, vaultId);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(async () => {
  useVaultStore().lock();
  await useVaultStore().flushPendingOperations();
  vi.unstubAllGlobals();
});
it("resumes the durable cursor and retains it on an empty terminal page", async () => {
  await setCachedPullCursor(user, vaultId, "saved-cursor");
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        protocol_version: 1,
        operations: [],
        next_cursor: null,
      }),
    ),
  );
  await useVaultStore().loadNotes(vaultId);
  expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain(
    "cursor=saved-cursor",
  );
  expect(await getCachedPullCursor(user, vaultId)).toBe("saved-cursor");
});
it("preserves pending local content while pulling a competing remote edit", async () => {
  const vault = useVaultStore();
  vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
  await vault.saveNote({ id: note, content: "local" });
  await vault.flushPendingOperations();
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          protocol_version: 1,
          operations: [op("remote")],
          next_cursor: "next",
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          protocol_version: 1,
          operations: [],
          next_cursor: null,
        }),
      ),
    );
  await vault.loadNotes(vaultId);
  expect(vault.notes.get(note)?.content).toBe("local");
});
it("does not repopulate plaintext when a pending pull completes after locking", async () => {
  let release!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(
    async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const vault = useVaultStore();
  const loading = vault.loadNotes(vaultId);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  vault.lock();
  release(
    new Response(
      JSON.stringify({
        protocol_version: 1,
        operations: [op("remote")],
        next_cursor: null,
      }),
    ),
  );
  await loading.catch(() => {});
  expect(vault.notes.size).toBe(0);
  expect(vault.activeConflict).toBeNull();
});
it("pulls before delivery and keeps a concurrently changed note as an explicit conflict", async () => {
  const vault = useVaultStore();
  vault.setSyncWakeup(() => {});
  const local = await vault.saveNote({ id: note, content: "local latest" });
  const remote = op("remote latest");
  const requests: string[] = [];
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    requests.push(init?.method ?? "GET");
    if (init?.method === "POST")
      return new Response(
        JSON.stringify({
          protocol_version: 1,
          operation_id: local.operation_id,
          vault_id: vaultId,
          note_id: note,
          base_revision: 0,
          remote_revision: 1,
          base_ciphertext_hash: "0".repeat(64),
          local_ciphertext_hash: local.ciphertext_hash,
          remote_ciphertext_hash: remote.ciphertext_hash,
        }),
        { status: 409 },
      );
    return new Response(
      JSON.stringify({
        protocol_version: 1,
        operations: [remote],
        next_cursor: null,
      }),
    );
  });
  await vault.synchronize();
  expect(requests).toEqual(["GET", "POST", "GET"]);
  expect(vault.activeConflict?.base).toBe("");
  expect(vault.activeConflict?.local).toBe("local latest");
  expect(vault.activeConflict?.remote).toBe("remote latest");
  expect(vault.notes.get(note)?.content).toBe("local latest");
});
it("clears a rejected durable cursor even when the replacement snapshot is empty", async () => {
  await setCachedPullCursor(user, vaultId, "expired");
  vi.mocked(fetch)
    .mockResolvedValueOnce(new Response("{}", { status: 409 }))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          protocol_version: 1,
          operations: [],
          next_cursor: null,
        }),
      ),
    );
  await useVaultStore().loadNotes(vaultId);
  expect(await getCachedPullCursor(user, vaultId)).toBeNull();
});
it("coalesces direct loading with coordinator loading", async () => {
  let release!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(
    async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const vault = useVaultStore();
  const first = vault.loadNotes(vaultId);
  const second = vault.synchronize();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(fetch).toHaveBeenCalledTimes(1);
  release(
    new Response(
      JSON.stringify({
        protocol_version: 1,
        operations: [],
        next_cursor: null,
      }),
    ),
  );
  await Promise.all([first, second]);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not repeatedly push an operation rejected with an unmaterializable conflict", async () => {
  const vault = useVaultStore();
  vault.setSyncWakeup(() => {});
  await vault.saveNote({ id: note, content: "local" });
  let pushes = 0;
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method === "POST") {
      pushes++;
      return new Response("{}", { status: 409 });
    }
    return new Response(
      JSON.stringify({
        protocol_version: 1,
        operations: [],
        next_cursor: null,
      }),
    );
  });
  await vault.synchronize();
  await vault.synchronize();
  expect(pushes).toBe(1);
  expect(vault.syncStatus).toBe("conflict");
});
it("refuses to fabricate an empty base from retained incomplete history", async () => {
  const vault = useVaultStore();
  vault.unlock(key, vaultId, 1);
  vault.setSyncWakeup(() => {});
  const local = await vault.saveNote({ id: note, content: "local" });
  const remote = op("remote", 2);
  vi.mocked(fetch).mockImplementation(
    async (_url, init) =>
      new Response(
        JSON.stringify(
          init?.method === "POST"
            ? {
                protocol_version: 1,
                operation_id: local.operation_id,
                vault_id: vaultId,
                note_id: note,
                base_revision: 1,
                remote_revision: 3,
                base_ciphertext_hash: "b".repeat(64),
                local_ciphertext_hash: local.ciphertext_hash,
                remote_ciphertext_hash: remote.ciphertext_hash,
              }
            : { protocol_version: 1, operations: [remote], next_cursor: null },
        ),
        { status: init?.method === "POST" ? 409 : 200 },
      ),
  );
  await vault.synchronize();
  expect(vault.activeConflict).toBeNull();
  expect(vault.syncStatus).toBe("conflict");
  expect(vault.notes.get(note)?.content).toBe("local");
});
it("recovers a persisted conflict after store restart without resending the rejected mutation", async () => {
  let vault = useVaultStore();
  vault.setSyncWakeup(() => {});
  const local = await vault.saveNote({ id: note, content: "local" });
  const remote = op("remote");
  vi.mocked(fetch).mockImplementation(
    async (_url, init) =>
      new Response(
        JSON.stringify(
          init?.method === "POST"
            ? {
                protocol_version: 1,
                operation_id: local.operation_id,
                vault_id: vaultId,
                note_id: note,
                base_revision: 0,
                remote_revision: 1,
                base_ciphertext_hash: "0".repeat(64),
                local_ciphertext_hash: local.ciphertext_hash,
                remote_ciphertext_hash: remote.ciphertext_hash,
              }
            : { protocol_version: 1, operations: [remote], next_cursor: null },
        ),
        { status: init?.method === "POST" ? 409 : 200 },
      ),
  );
  await vault.synchronize();
  vault.lock();
  setActivePinia(createPinia());
  useAuthStore().userId = user;
  useAuthStore().isAuthenticated = true;
  vault = useVaultStore();
  vault.unlock(key, vaultId);
  vi.mocked(fetch).mockClear();
  await vault.synchronize();
  expect(
    vi.mocked(fetch).mock.calls.every(([, init]) => init?.method !== "POST"),
  ).toBe(true);
  expect(vault.activeConflict?.local).toBe("local");
  expect(vault.activeConflict?.remote).toBe("remote");
});
it("bounds a server cursor cycle instead of pulling indefinitely", async () => {
  let page = 0;
  vi.mocked(fetch).mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          protocol_version: 1,
          operations: [],
          next_cursor: ["a", "b", "a"][page++],
        }),
      ),
  );
  await expect(useVaultStore().loadNotes(vaultId)).rejects.toThrow(
    "Invalid sync page",
  );
  expect(fetch).toHaveBeenCalledTimes(3);
});
