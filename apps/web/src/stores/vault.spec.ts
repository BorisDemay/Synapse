import "fake-indexeddb/auto";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetOfflineDbHandle } from "../offline/cache";
import { getVaultPreferences } from "../offline/cache";
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

  it("stores saved searches and pins only in an encrypted local preferences envelope", async () => {
    const vault = useVaultStore();
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    vault.unlock(key, vaultId, 0);
    await vault.savePreferences({
      ...vault.preferences,
      pinnedNoteIds: [noteId],
      recentNoteIds: [noteId],
      savedSearches: [
        { id: "search-1", label: "Active", query: "property:status=active" },
      ],
    });

    const record = await getVaultPreferences(userId, vaultId);
    expect(JSON.stringify(record)).not.toContain("property:status=active");
    expect(vault.preferences.pinnedNoteIds).toEqual([noteId]);
    expect(vault.preferences.savedSearches).toEqual([
      { id: "search-1", label: "Active", query: "property:status=active" },
    ]);
  });

  it("keeps a named restore point in encrypted local preferences", async () => {
    const vault = useVaultStore();
    vault.unlock(
      Uint8Array.from({ length: 32 }, (_, index) => index),
      vaultId,
      3,
    );
    vault.notes.set(noteId, {
      content: "# snapshot",
      path: "snapshot.md",
      revision: 3,
    });

    await vault.createRestorePoint(noteId, "Avant refonte");

    expect(vault.restorePointsFor(noteId)).toEqual([
      expect.objectContaining({ label: "Avant refonte", noteId, revision: 3 }),
    ]);
    const record = await getVaultPreferences(userId, vaultId);
    expect(JSON.stringify(record)).not.toContain("Avant refonte");
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

  it("rewrapping the passphrase keeps the vault key out of persistent storage", async () => {
    let envelopeBytes: number[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/vaults" && method === "POST") {
        return new Response(JSON.stringify({ id: vaultId }), { status: 201 });
      }
      if (url.includes("/envelope") && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { bytes: number[] };
        envelopeBytes = body.bytes;
        return new Response(null, { status: 204 });
      }
      if (url.includes("/envelope")) {
        return new Response(JSON.stringify({ bytes: envelopeBytes }), {
          status: 200,
        });
      }
      throw new TypeError("offline");
    });
    const vault = useVaultStore();
    await vault.createAndUnlockVault("old passphrase long");
    await vault.changePassphrase("old passphrase long", "new passphrase long");

    const { parseWrappedVaultKey, unlockVaultKey } = await import(
      "../crypto/vault-key"
    );
    const envelope = parseWrappedVaultKey(envelopeBytes);
    await expect(
      unlockVaultKey(envelope, "new passphrase long"),
    ).resolves.toHaveLength(32);
    await expect(
      unlockVaultKey(envelope, "old passphrase long"),
    ).rejects.toThrow("Unable to unlock vault");
    expect(JSON.stringify(envelopeBytes)).not.toContain("new passphrase long");
    expect(localStorage.length).toBe(0);
  });

  it("exports decrypted notes as markdown titles without touching the network", () => {
    const vault = useVaultStore();
    vault.unlock(
      Uint8Array.from({ length: 32 }, (_, index) => index),
      vaultId,
      0,
    );
    vault.notes.set(noteId, {
      content: "# Journal\n\nSecret line",
      revision: 1,
    });

    expect(vault.markdownExportNotes()).toEqual([
      { content: "# Journal\n\nSecret line", title: "Journal" },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("unlocks from a trusted device wrap without a passphrase", async () => {
    const vault = useVaultStore();
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    vault.unlock(key, vaultId, 0);
    await vault.rememberCurrentDevice();
    vault.lock();
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/v1/vaults") {
        return new Response(JSON.stringify({ vaults: [{ id: vaultId }] }), {
          status: 200,
        });
      }
      throw new TypeError("offline");
    });

    await expect(vault.tryUnlockFromTrustedDevice()).resolves.toBe(true);
    expect(vault.isUnlocked).toBe(true);
  });

  it("skips trusted auto-unlock after an explicit lock", async () => {
    const vault = useVaultStore();
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    vault.unlock(key, vaultId, 0);
    await vault.rememberCurrentDevice();
    vault.lockAndRequirePassphrase();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ vaults: [{ id: vaultId }] }), {
        status: 200,
      }),
    );

    await expect(vault.tryUnlockFromTrustedDevice()).resolves.toBe(false);
    expect(vault.isUnlocked).toBe(false);
  });

  it("hides a deleted note after pushing an encrypted tombstone", async () => {
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
    await vault.saveNote({ content: "# Keep me secret", id: noteId });
    expect(vault.notes.get(noteId)?.content).toBe("# Keep me secret");

    const result = await vault.deleteNote(noteId);

    expect(vault.notes.has(noteId)).toBe(false);
    expect(JSON.stringify(result)).not.toContain("# Keep me secret");
    expect(JSON.stringify(result)).not.toContain("Keep me secret");
    expect(fetch).toHaveBeenLastCalledWith(
      `/v1/vaults/${vaultId}/operations`,
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    );
  });

  it("does not restore a tombstoned note when loading encrypted operations", async () => {
    const vault = useVaultStore();
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    vault.unlock(key, vaultId);

    const { xchacha20poly1305 } = await import("@noble/ciphers/chacha.js");
    const nonce = Uint8Array.from({ length: 24 }, (_, index) => index + 1);
    const plaintext = new TextEncoder().encode("\u0000synapse/deleted");
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

    expect(vault.notes.has(noteId)).toBe(false);
    expect(vault.syncStatus).toBe("synced");
  });

  it("omits deleted notes from a markdown export", () => {
    const vault = useVaultStore();
    vault.unlock(
      Uint8Array.from({ length: 32 }, (_, index) => index),
      vaultId,
      0,
    );
    vault.notes.set(noteId, {
      content: "\u0000synapse/deleted",
      revision: 1,
    });

    expect(vault.markdownExportNotes()).toEqual([]);
  });

  it("indexes decrypted notes for search, backlinks and history restore", async () => {
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
    const sourceId = "0198e5de-aaaa-7bbb-8ccc-ddddeeeeffff";
    await vault.saveNote({
      content: "---\ntags:\n- projet\n---\n# Roadmap\n\n[[Inbox]]",
      id: sourceId,
      path: "projets/roadmap.md",
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ operation_id: "y", revision: 2 }), {
        status: 201,
      }),
    );
    await vault.saveNote({
      content: "# Inbox\n\nHello",
      id: noteId,
      path: "inbox.md",
    });

    expect(vault.searchNotes("tag:projet").map((note) => note.id)).toEqual([
      sourceId,
    ]);
    expect(vault.backlinksForNote(noteId)).toEqual([
      { id: sourceId, label: "Roadmap" },
    ]);
    expect(vault.listedTags()).toEqual(["projet"]);

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ operation_id: "z", revision: 3 }), {
        status: 201,
      }),
    );
    await vault.saveNote({ content: "# Inbox\n\nChanged", id: noteId });
    await vault.restoreRevision(noteId, 2);
    expect(vault.notes.get(noteId)?.content).toBe("# Inbox\n\nHello");
  });

  it("encrypts attachments without putting the filename on the wire", async () => {
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
    const result = await vault.saveAttachment({
      bytes: new Uint8Array([137, 80, 78, 71]),
      contentType: "image/png",
      path: "attachments/secret.png",
    });

    expect(JSON.stringify(result)).not.toContain("secret.png");
    expect(JSON.stringify(result)).not.toContain("attachments/");
    expect([...vault.attachments.values()][0]?.path).toBe(
      "attachments/secret.png",
    );
    await expect(
      vault.saveAttachment({
        bytes: new Uint8Array([1]),
        contentType: "application/octet-stream",
        path: "attachments/payload.exe",
      }),
    ).rejects.toThrow("Invalid attachment");
  });

  it("renames a note while keeping the same identifier", async () => {
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
    await vault.saveNote({
      content: "# Kept",
      id: noteId,
      path: "inbox.md",
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ operation_id: "y", revision: 2 }), {
        status: 201,
      }),
    );
    await vault.renameNote(noteId, "projets/kept.md");
    expect(vault.notes.get(noteId)?.path).toBe("projets/kept.md");
    expect(vault.notes.get(noteId)?.content).toBe("# Kept");
  });
});
