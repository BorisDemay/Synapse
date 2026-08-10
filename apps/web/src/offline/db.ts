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

export type QueuedOperationRecord = EncryptedPushOperation & {
  userId: string;
};

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
  queue: {
    key: string;
    value: QueuedOperationRecord;
  };
}

const DB_NAME = "synapse-offline-v1";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<SynapseOfflineSchema>> | undefined;

export function noteKey(userId: string, vaultId: string, noteId: string): string {
  return `${userId}:${vaultId}:${noteId}`;
}

export function envelopeKey(userId: string, vaultId: string): string {
  return `${userId}:${vaultId}`;
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

export function openOfflineDb(): Promise<
  IDBPDatabase<SynapseOfflineSchema>
> {
  if (!dbPromise) {
    dbPromise = openDB<SynapseOfflineSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const store of ["notes", "envelopes", "meta", "queue"] as const) {
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
