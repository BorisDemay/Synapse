import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const AAD_PREFIX = "synapse/vault-preferences/v1";

export interface SavedSearch {
  id: string;
  label: string;
  query: string;
}

export interface RestorePoint {
  id: string;
  label: string;
  noteId: string;
  recordedAt: string;
  revision: number;
}

export interface VaultPreferences {
  pinnedNoteIds: string[];
  recentNoteIds: string[];
  restorePoints: RestorePoint[];
  savedSearches: SavedSearch[];
  templatesPath: string;
}

export interface VaultPreferencesEnvelope {
  ciphertext: number[];
  nonce: number[];
}

export const DEFAULT_VAULT_PREFERENCES: VaultPreferences = {
  pinnedNoteIds: [],
  recentNoteIds: [],
  restorePoints: [],
  savedSearches: [],
  templatesPath: "Templates",
};

function aad(vaultId: string): Uint8Array {
  return new TextEncoder().encode(`${AAD_PREFIX}/${vaultId}`);
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(24);
  crypto.getRandomValues(nonce);
  return nonce;
}

function parsePreferences(value: unknown): VaultPreferences {
  if (!value || typeof value !== "object") {
    throw new Error("invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.templatesPath !== "string" ||
    !Array.isArray(record.pinnedNoteIds) ||
    !record.pinnedNoteIds.every((id) => typeof id === "string") ||
    (record.recentNoteIds !== undefined &&
      (!Array.isArray(record.recentNoteIds) ||
        !record.recentNoteIds.every((id) => typeof id === "string"))) ||
    (record.restorePoints !== undefined &&
      (!Array.isArray(record.restorePoints) ||
        !record.restorePoints.every(
          (point) =>
            Boolean(point) &&
            typeof point === "object" &&
            typeof (point as Record<string, unknown>).id === "string" &&
            typeof (point as Record<string, unknown>).label === "string" &&
            typeof (point as Record<string, unknown>).noteId === "string" &&
            typeof (point as Record<string, unknown>).recordedAt === "string" &&
            typeof (point as Record<string, unknown>).revision === "number",
        ))) ||
    !Array.isArray(record.savedSearches) ||
    !record.savedSearches.every(
      (search) =>
        Boolean(search) &&
        typeof search === "object" &&
        typeof (search as Record<string, unknown>).id === "string" &&
        typeof (search as Record<string, unknown>).label === "string" &&
        typeof (search as Record<string, unknown>).query === "string",
    )
  ) {
    throw new Error("invalid");
  }
  return {
    pinnedNoteIds: [...record.pinnedNoteIds],
    recentNoteIds: Array.isArray(record.recentNoteIds)
      ? [...record.recentNoteIds]
      : [],
    restorePoints: Array.isArray(record.restorePoints)
      ? (record.restorePoints as RestorePoint[]).map((point) => ({ ...point }))
      : [],
    savedSearches: (record.savedSearches as SavedSearch[]).map((search) => ({
      ...search,
    })),
    templatesPath: record.templatesPath,
  };
}

export function wrapVaultPreferences(
  vaultKey: Uint8Array,
  vaultId: string,
  preferences: VaultPreferences,
): VaultPreferencesEnvelope {
  if (vaultKey.length !== 32) {
    throw new Error("Unable to store vault preferences");
  }
  const nonce = randomNonce();
  const plaintext = new TextEncoder().encode(JSON.stringify(preferences));
  return {
    ciphertext: Array.from(
      xchacha20poly1305(vaultKey, nonce, aad(vaultId)).encrypt(plaintext),
    ),
    nonce: Array.from(nonce),
  };
}

export function unwrapVaultPreferences(
  vaultKey: Uint8Array,
  vaultId: string,
  envelope: VaultPreferencesEnvelope,
): VaultPreferences {
  try {
    if (vaultKey.length !== 32 || envelope.nonce.length !== 24) {
      throw new Error("invalid");
    }
    const plaintext = xchacha20poly1305(
      vaultKey,
      Uint8Array.from(envelope.nonce),
      aad(vaultId),
    ).decrypt(Uint8Array.from(envelope.ciphertext));
    return parsePreferences(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    throw new Error("Unable to read vault preferences");
  }
}
