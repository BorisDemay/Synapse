import { invoke } from "@tauri-apps/api/core";

import {
  installLocalFolderAdapter,
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
