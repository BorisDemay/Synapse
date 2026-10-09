<script setup lang="ts">
import {
  isLocalFolderSupported,
  chooseLocalVaultFolder,
  localFolderStatus,
  mirrorVaultSnapshot,
} from "../platform/local-folder";
import { useVaultStore } from "../stores/vault";
const vault = useVaultStore();
async function choose() {
  const vaultId = vault.currentVaultId;
  if (!vaultId || !vault.isUnlocked) return;
  let cancelled = false;
  const stop = vault.$onAction(({ name }) => {
    if (name === "lock" || name === "lockAndRequirePassphrase")
      cancelled = true;
  });
  try {
    const path = await chooseLocalVaultFolder(vaultId);
    if (
      cancelled ||
      !path ||
      !vault.isUnlocked ||
      vault.currentVaultId !== vaultId
    )
      return;
    await mirrorVaultSnapshot(vaultId, [
      ...vault.markdownExportNotes().map((note) => ({
        kind: "note" as const,
        path: note.path!,
        markdown: note.content,
      })),
      ...vault.markdownExportAttachments().map((file) => ({
        kind: "attachment" as const,
        path: file.path,
        bytes: Array.from(file.bytes),
      })),
    ]);
  } catch {
    localFolderStatus.error =
      "Impossible de choisir ce dossier. Choisissez un dossier vide.";
  } finally {
    stop();
  }
}
</script>
<template>
  <aside v-if="isLocalFolderSupported()" aria-label="Copie Markdown locale">
    <p v-if="localFolderStatus.path">
      Dossier Markdown : {{ localFolderStatus.path }}
    </p>
    <p>
      Les fichiers Markdown de ce dossier restent lisibles après verrouillage.
    </p>
    <button type="button" @click="choose">Changer le dossier Markdown</button>
    <p v-if="localFolderStatus.error" role="alert">
      {{ localFolderStatus.error }}
    </p>
  </aside>
</template>
