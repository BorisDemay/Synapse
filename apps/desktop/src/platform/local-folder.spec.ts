import "../../../web/node_modules/fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  installDesktopLocalFolder,
  startDesktopFolderMirroring,
} from "./local-folder";
import {
  chooseLocalVaultFolder,
  localFolderStatus,
} from "../../../web/src/platform/local-folder";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
describe("desktop durable folder replica", () => {
  beforeEach(() => {
    invoke.mockReset();
    installDesktopLocalFolder();
  });
  it("preserves picker cancellation", async () => {
    invoke.mockResolvedValue(null);
    expect(await chooseLocalVaultFolder("")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("choose_local_vault_folder", {
      vaultId: null,
    });
  });
  it("mirrors only completed durable actions and never deletes files on lock", async () => {
    let listener: any;
    const vault: any = {
      currentVaultId: "vault",
      isUnlocked: true,
      $onAction: (callback: any) => {
        listener = callback;
        return () => {};
      },
      markdownExportNotes: () => [{ path: "note.md", content: "durable" }],
      markdownExportAttachments: () => [],
    };
    invoke.mockResolvedValue("/chosen");
    startDesktopFolderMirroring(vault);
    let completed: any;
    listener({
      name: "saveNote",
      after: (callback: any) => {
        completed = callback;
      },
    });
    expect(invoke).not.toHaveBeenCalled();
    completed();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("mirror_local_vault_folder", {
        vaultId: "vault",
        entries: [{ kind: "note", path: "note.md", markdown: "durable" }],
      }),
    );
    invoke.mockClear();
    vault.isUnlocked = false;
    completed();
    await Promise.resolve();
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("reports folder failure without rejecting the durable action", async () => {
    const { mirrorVaultSnapshot } = await import(
      "../../../web/src/platform/local-folder"
    );
    invoke.mockRejectedValue(new Error("disk failure"));
    await expect(mirrorVaultSnapshot("vault", [])).resolves.toBeNull();
    expect(localFolderStatus.error).toContain("cache chiffré");
  });
});

it("mirrors remote changes pulled by the real store synchronize action", async () => {
  const { createPinia, setActivePinia } = await import("pinia");
  const { useVaultStore } = await import("../../../web/src/stores/vault");
  const { useAuthStore } = await import("../../../web/src/stores/auth");
  const { xchacha20poly1305 } = await import("@noble/ciphers/chacha.js");
  const { encodeNotePlaintext } = await import(
    "../../../web/src/crypto/vault-item"
  );
  const { clearUserOfflineData } = await import(
    "../../../web/src/offline/cache"
  );
  const userId = "mirror-integration";
  const vaultId = "0198e5de-1111-7222-8333-444455556666";
  const noteId = "0198e5de-7777-7888-8999-aaaabbbbcccc";
  await clearUserOfflineData(userId);
  setActivePinia(createPinia());
  const auth = useAuthStore();
  auth.userId = userId;
  auth.isAuthenticated = true;
  const vault = useVaultStore();
  const key = new Uint8Array(32).fill(1);
  const nonce = new Uint8Array(24).fill(2);
  const ciphertext = xchacha20poly1305(
    key,
    nonce,
    new TextEncoder().encode(`synapse/aad/1/${vaultId}/${noteId}/0`),
  ).encrypt(encodeNotePlaintext("remote.md", "remote content"));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          protocol_version: 1,
          next_cursor: null,
          operations: [
            {
              protocol_version: 1,
              operation_id: "0198e5de-aaaa-7bbb-8ccc-ddddeeeefff1",
              vault_id: vaultId,
              note_id: noteId,
              base_revision: 0,
              revision: 1,
              nonce: Array.from(nonce),
              ciphertext: Array.from(ciphertext),
              ciphertext_hash: "aa".repeat(32),
              aad_version: 1,
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  );
  installDesktopLocalFolder();
  invoke.mockReset().mockResolvedValue("/chosen");
  vault.unlock(key, vaultId, 0);
  const stop = startDesktopFolderMirroring(vault);
  try {
    await vault.synchronize();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("mirror_local_vault_folder", {
        vaultId,
        entries: [
          { kind: "note", path: "remote.md", markdown: "remote content" },
        ],
      }),
    );
  } finally {
    stop();
    vault.lock();
    vi.unstubAllGlobals();
  }
});
