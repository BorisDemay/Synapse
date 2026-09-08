import { reactive } from "vue";

export const localFolderStatus = reactive({ path: "", error: "" });

export type FolderEntry =
  | { kind: "attachment"; bytes: number[]; path: string }
  | { kind: "note"; markdown: string; path: string };

export interface LocalFolderAdapter {
  bind(vaultId: string, path: string): Promise<string | null>;
  choose(vaultId: string): Promise<string | null>;
  ensure(vaultId: string): Promise<string | null>;
  snapshot(vaultId: string, entries: FolderEntry[]): Promise<string | null>;
  supported: boolean;
}

const noopAdapter: LocalFolderAdapter = {
  supported: false,
  async bind() {
    return null;
  },
  async choose() {
    return null;
  },
  async ensure() {
    return null;
  },
  async snapshot() {
    return null;
  },
};

let adapter: LocalFolderAdapter = noopAdapter;

export function installLocalFolderAdapter(next: LocalFolderAdapter): void {
  adapter = next;
}

export function resetLocalFolderAdapterForTests(): void {
  adapter = noopAdapter;
}

export function isLocalFolderSupported(): boolean {
  return adapter.supported;
}

export async function ensureLocalVaultFolder(
  vaultId: string,
): Promise<string | null> {
  return adapter.ensure(vaultId);
}

export async function chooseLocalVaultFolder(
  vaultId: string,
): Promise<string | null> {
  return adapter.choose(vaultId);
}

export async function bindLocalVaultFolder(
  vaultId: string,
  path: string,
): Promise<string | null> {
  return adapter.bind(vaultId, path);
}

export async function mirrorVaultSnapshot(
  vaultId: string,
  entries: FolderEntry[],
): Promise<string | null> {
  try {
    const path = await adapter.snapshot(vaultId, entries);
    localFolderStatus.path = path ?? "";
    localFolderStatus.error = "";
    return path;
  } catch {
    localFolderStatus.error =
      "La copie du dossier a échoué. Vos modifications restent dans le cache chiffré. Choisissez un dossier vide si des fichiers ont été modifiés ailleurs.";
    return null;
  }
}
