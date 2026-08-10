import "fake-indexeddb/auto";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetOfflineDbHandle } from "../offline/cache";
import { useAuthStore } from "./auth";
import { useVaultStore } from "./vault";

const userId = "0198e5de-user-7000-8000-000000000001";
const vaultId = "0198e5de-1111-7222-8333-444455556666";
const noteId = "0198e5de-7777-7888-8999-aaaabbbbcccc";

describe("vault store", () => {
  beforeEach(() => {
    resetOfflineDbHandle();
    indexedDB.deleteDatabase("synapse-offline-v1");
    resetOfflineDbHandle();
    setActivePinia(createPinia());
    useAuthStore().userId = userId;
    useAuthStore().isAuthenticated = true;
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("window", {
      location: { origin: "https://synapse.local" },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("marks encrypted edits as saving then synced after a cookie-authenticated push", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ operation_id: "x", revision: 1 }), {
        status: 201,
      }),
    );
    const vault = useVaultStore();
    vault.unlock(
      Uint8Array.from({ length: 32 }, (_, index) => index),
      vaultId,
      0,
    );

    const result = await vault.saveNote({
      content: "# Private note",
      id: noteId,
    });

    expect(JSON.stringify(result)).not.toContain("# Private note");
    expect(
      new TextDecoder().decode(Uint8Array.from(result.ciphertext)),
    ).not.toContain("# Private note");
    expect(result.base_revision).toBe(0);
    expect(result.operation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(fetch).toHaveBeenCalledWith(
      `/v1/vaults/${vaultId}/operations`,
      expect.objectContaining({
        credentials: "include",
        headers: {
          Origin: "https://synapse.local",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(vault.syncStatus).toBe("synced");
    expect(vault.headRevision).toBe(1);
  });

  it("creates a vault envelope then unlocks it in memory", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: vaultId }), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const vault = useVaultStore();
    await vault.createAndUnlockVault("unlock passphrase long");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/vaults",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `/v1/vaults/${vaultId}/envelope`,
      expect.objectContaining({ method: "PUT" }),
    );
    expect(vault.isUnlocked).toBe(true);
    expect(vault.currentVaultId).toBe(vaultId);
    expect(localStorage.length).toBe(0);
  });

  it("loads paginated encrypted operations and decrypts them locally", async () => {
    const vault = useVaultStore();
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    vault.unlock(key, vaultId);

    const { xchacha20poly1305 } = await import("@noble/ciphers/chacha.js");
    const nonce = Uint8Array.from({ length: 24 }, (_, index) => index + 1);
    const plaintext = new TextEncoder().encode("# Secret note");
    const aad = new TextEncoder().encode(
      `synapse/aad/1/${vaultId}/${noteId}/0`,
    );
    const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);

    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          next_cursor: null,
          operations: [
            {
              aad_version: 1,
              base_revision: 0,
              ciphertext: Array.from(ciphertext),
              ciphertext_hash: "a".repeat(64),
              nonce: Array.from(nonce),
              note_id: noteId,
              operation_id: "0198e5de-aaaa-7bbb-8ccc-ddddeeeeffff",
              protocol_version: 1,
              vault_id: vaultId,
            },
          ],
          protocol_version: 1,
        }),
        { status: 200 },
      ),
    );

    await vault.loadNotes(vaultId);

    expect(fetch).toHaveBeenCalledWith(
      `/v1/vaults/${vaultId}/operations?limit=100`,
      { credentials: "include" },
    );
    expect(vault.notes.get(noteId)?.content).toBe("# Secret note");
    expect(vault.syncStatus).toBe("synced");
    expect(vault.headRevision).toBe(1);
  });

  it.each(["offline", "conflict", "error"] as const)(
    "exposes the %s sync state without dropping a local edit",
    async (status) => {
      vi.mocked(fetch).mockRejectedValue(new TypeError("network unavailable"));
      const vault = useVaultStore();
      vault.unlock(
        Uint8Array.from({ length: 32 }, (_, index) => index),
        vaultId,
      );

      await vault.saveNote({
        content: "local",
        id: noteId,
      });
      if (status !== "offline") vault.setSyncStatus(status);

      expect(vault.syncStatus).toBe(status);
      expect(vault.notes.get(noteId)?.content).toBe("local");
    },
  );

  it("queues an encrypted edit offline then flushes it after reconnect", async () => {
    const vault = useVaultStore();
    vault.unlock(
      Uint8Array.from({ length: 32 }, (_, index) => index),
      vaultId,
      0,
    );

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
    await vault.saveNote({ content: "# queued", id: noteId });
    expect(vault.syncStatus).toBe("offline");
    expect(vault.notes.get(noteId)?.content).toBe("# queued");

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ operation_id: "x", revision: 1 }), {
        status: 201,
      }),
    );
    await vault.flushPendingOperations();
    expect(vault.syncStatus).toBe("synced");
    expect(vault.headRevision).toBe(1);
  });

  it("purges the in-memory key on lock while keeping the encrypted cache", async () => {
    const vault = useVaultStore();
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    vault.unlock(key, vaultId, 0);
    vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
    await vault.saveNote({ content: "# keep ciphertext", id: noteId });
    vault.lock();
    expect(vault.isUnlocked).toBe(false);

    vault.unlock(key.slice(), vaultId, 0);
    vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
    await vault.loadNotes(vaultId);
    expect(vault.notes.get(noteId)?.content).toBe("# keep ciphertext");
    expect(vault.syncStatus).toBe("offline");
  });

  it("builds a resolution request that carries conflict id and expected hashes", async () => {
    const vault = useVaultStore();
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    vault.unlock(key, vaultId, 2);
    vault.activeConflict = {
      base: "base text",
      conflict: {
        base_ciphertext_hash: "aa".repeat(32),
        base_revision: 1,
        local_ciphertext_hash: "bb".repeat(32),
        note_id: noteId,
        operation_id: "0198e5de-aaaa-7bbb-8ccc-ddddeeeefff9",
        protocol_version: 1,
        remote_ciphertext_hash: "cc".repeat(32),
        remote_revision: 2,
        vault_id: vaultId,
      },
      local: "local text",
      manualDraft: "local text",
      noteId,
      remote: "remote text",
    };

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ operation_id: "x", revision: 3 }), {
        status: 201,
      }),
    );

    const resolution = await vault.resolveConflict("local text");
    expect(resolution).toEqual({
      conflict_id: "0198e5de-aaaa-7bbb-8ccc-ddddeeeefff9",
      expected_base_hash: "aa".repeat(32),
      expected_local_hash: "bb".repeat(32),
      expected_remote_hash: "cc".repeat(32),
      resolved_operation_id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    });
    expect(vault.activeConflict).toBeNull();
    expect(vault.syncStatus).toBe("synced");
  });
});
