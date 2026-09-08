import { invoke } from "@tauri-apps/api/core";

import {
  installLocalFolderAdapter,
  mirrorVaultSnapshot,
  type FolderEntry,
} from "../../../web/src/platform/local-folder";

export function installDesktopLocalFolder(): void {
  installLocalFolderAdapter({
    supported: true,
    async bind(vaultId, path) {
      return invoke<string>("bind_local_vault_folder", { path, vaultId });
    },
    async choose(vaultId) {
      return invoke<string | null>("choose_local_vault_folder", {
        vaultId: vaultId || null,
      });
    },
    async ensure(vaultId) {
      return invoke<string>("ensure_local_vault_folder", { vaultId });
    },
    async snapshot(vaultId, entries: FolderEntry[]) {
      return invoke<string>("mirror_local_vault_folder", { vaultId, entries });
    },
  });
}

/** Mirror only after a durable store action finishes; locking never emits an empty snapshot. */
export function startDesktopFolderMirroring(
  vault: ReturnType<
    typeof import("../../../web/src/stores/vault").useVaultStore
  >,
): () => void {
  let pending = Promise.resolve();
  return vault.$onAction(({ name, after }) => {
    if (
      ![
        "saveNote",
        "saveAttachment",
        "renameNote",
        "deleteNote",
        "loadNotes",
        "resolveConflict",
        "restoreRevision",
      ].includes(name)
    )
      return;
    after(() => {
      const vaultId = vault.currentVaultId;
      pending = pending.then(async () => {
        if (!vaultId || !vault.isUnlocked || vault.currentVaultId !== vaultId)
          return;
        const entries: FolderEntry[] = [
          ...vault
            .markdownExportNotes()
            .map((note) => ({
              kind: "note" as const,
              path: note.path!,
              markdown: note.content,
            })),
          ...vault
            .markdownExportAttachments()
            .map((file) => ({
              kind: "attachment" as const,
              path: file.path,
              bytes: Array.from(file.bytes),
            })),
        ];
        await mirrorVaultSnapshot(vaultId, entries);
      });
    });
  });
}
