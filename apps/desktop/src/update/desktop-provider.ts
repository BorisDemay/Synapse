import { Channel, invoke } from "@tauri-apps/api/core";

import type { UpdateMetadata, UpdateProvider } from "@synapse/ui";

interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

export function createDesktopUpdateProvider(): UpdateProvider {
  return {
    check: () => invoke<UpdateMetadata | null>("check_desktop_update"),
    async prepare(_metadata, onProgress, onStatus) {
      onStatus("Téléchargement de la mise à jour…");
      const channel = new Channel<DownloadProgress>();
      channel.onmessage = ({ downloaded, total }) => {
        if (total && total > 0) onProgress(downloaded / total);
      };
      await invoke("download_desktop_update", { onEvent: channel });
      onProgress(1);
    },
    async apply(_metadata, onStatus) {
      onStatus("Installation et redémarrage…");
      await invoke("install_desktop_update");
    },
  };
}
