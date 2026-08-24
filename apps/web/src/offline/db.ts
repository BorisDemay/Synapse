import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { EncryptedPushOperation } from "@synapse/api-client";

export interface CachedNoteRecord {
  ciphertext: number[];
  ciphertextHash: string;
  nonce: number[];
  noteId: string;
  revision: number;
  userId: string;
  vaultId: string;
}

export interface CachedEnvelopeRecord {
  bytes: number[];
  userId: string;
  vaultId: string;
}

export interface TrustedDeviceRecord {
  ciphertext: number[];
  iv: number[];
  userId: string;
  vaultId: string;
  wrappingKey: CryptoKey;
}

export interface CachedAssistantCredentialRecord {
  ciphertext: number[];
  nonce: number[];
  provider: "codex";
  userId: string;
  vaultId: string;
}

export interface CachedAssistantConversationsRecord {
  ciphertext: number[];
  nonce: number[];
  userId: string;
  vaultId: string;
}

export interface CachedVaultPreferencesRecord {
  ciphertext: number[];
  nonce: number[];
  userId: string;
  vaultId: string;
}

export type QueuedOperationRecord = EncryptedPushOperation & {
  userId: string;
};

export interface CachedRevisionRecord {
  baseRevision: number;
  ciphertext: number[];
  nonce: number[];
  noteId: string;
  recordedAt: string;
  revision: number;
  userId: string;
  vaultId: string;
}

interface SynapseOfflineSchema extends DBSchema {
  envelopes: {
    key: string;
    value: CachedEnvelopeRecord;
  };
  meta: {
    key: string;
    value: { key: string; value: string | number | null };
  };
  notes: {
    key: string;
    value: CachedNoteRecord;
  };
  note_revisions: {
    key: string;
    value: CachedRevisionRecord;
  };
  queue: {
    key: string;
    value: QueuedOperationRecord;
  };
  trusted_devices: {
    key: string;
    value: TrustedDeviceRecord;
  };
  ai_credentials: {
    key: string;
    value: CachedAssistantCredentialRecord;
  };
  ai_conversations: {
    key: string;
    value: CachedAssistantConversationsRecord;
  };
  vault_preferences: {
    key: string;
    value: CachedVaultPreferencesRecord;
  };
}

const DB_NAME = "synapse-offline-v1";
const DB_VERSION = 7;

let dbPromise: Promise<IDBPDatabase<SynapseOfflineSchema>> | undefined;

export function noteKey(
  userId: string,
  vaultId: string,
  noteId: string,
): string {
  return `${userId}:${vaultId}:${noteId}`;
}

export function envelopeKey(userId: string, vaultId: string): string {
  return `${userId}:${vaultId}`;
}

export function trustedDeviceKey(userId: string, vaultId: string): string {
  return `${userId}:${vaultId}`;
}

export function assistantCredentialKey(
  userId: string,
  vaultId: string,
): string {
  return `${userId}:${vaultId}:codex`;
}

export function assistantConversationsKey(
  userId: string,
  vaultId: string,
): string {
  return `${userId}:${vaultId}:codex-conversations`;
}

export function vaultPreferencesKey(userId: string, vaultId: string): string {
  return `${userId}:${vaultId}:preferences`;
}

export function revisionKey(
  userId: string,
  vaultId: string,
  noteId: string,
  revision: number,
): string {
  return `${userId}:${vaultId}:${noteId}:${revision}`;
}

export function metaKey(
  userId: string,
  name: "session-user" | "cursor" | "head",
  vaultId?: string,
): string {
  if (name === "session-user") {
    return `session:${userId}`;
  }
  return `${userId}:${vaultId}:${name}`;
}

export function openOfflineDb(): Promise<IDBPDatabase<SynapseOfflineSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<SynapseOfflineSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 3 && db.objectStoreNames.contains("trusted_devices")) {
          db.deleteObjectStore("trusted_devices");
        }
        for (const store of [
          "notes",
          "envelopes",
          "meta",
          "queue",
          "trusted_devices",
          "ai_credentials",
          "ai_conversations",
          "vault_preferences",
          "note_revisions",
        ] as const) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store);
          }
        }
      },
    });
  }
  return dbPromise;
}

/** Test helper: drop the shared promise so fake-indexeddb resets cleanly. */
export function resetOfflineDbHandle(): void {
  dbPromise = undefined;
}
