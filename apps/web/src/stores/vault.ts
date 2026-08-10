import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  buildPullOperationsPath,
  serializeEncryptedPushOperation,
  type Conflict,
  type EncryptedPushOperation,
  type PullResponse,
} from "@synapse/api-client";
import { defineStore } from "pinia";
import { reactive, ref } from "vue";

import {
  createWrappedVaultKey,
  encodeWrappedVaultKey,
  uuidV7,
} from "../crypto/vault-key";
import {
  clearUserOfflineData,
  getCachedEnvelope,
  getCachedHeadRevision,
  listCachedNotes,
  listCachedVaultIds,
  putCachedEnvelope,
  putCachedNote,
  setCachedHeadRevision,
  setCachedPullCursor,
} from "../offline/cache";
import {
  enqueueOperation,
  listPendingOperations,
  removeAckedOperation,
} from "../offline/queue";
import { useAuthStore } from "./auth";

export type SyncStatus = "saving" | "synced" | "offline" | "conflict" | "error";

export interface ActiveConflict {
  base: string;
  conflict: Conflict;
  local: string;
  manualDraft: string;
  noteId: string;
  remote: string;
}

interface NoteInput {
  content: string;
  id: string;
}

interface LocalNote {
  content: string;
  revision: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function aad(vaultId: string, noteId: string, revision: number): Uint8Array {
  return new TextEncoder().encode(
    `synapse/aad/1/${vaultId}/${noteId}/${revision}`,
  );
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(24);
  crypto.getRandomValues(nonce);
  return nonce;
}

function csrfHeaders(): HeadersInit {
  return {
    Origin: window.location.origin,
    "content-type": "application/json",
  };
}

function requireUserId(): string {
  const userId = useAuthStore().userId;
  if (!userId) {
    throw new Error("Missing authenticated user");
  }
  return userId;
}

export const useVaultStore = defineStore("vault", () => {
  let vaultKey: Uint8Array | undefined;
  const notes = reactive(new Map<string, LocalNote>());
  const syncStatus = ref<SyncStatus>("synced");
  const hasEncryptedVault = ref(false);
  const isUnlocked = ref(false);
  const currentVaultId = ref<string | null>(null);
  const headRevision = ref(0);
  const pullCursor = ref<string | null>(null);
  const lastError = ref<string | null>(null);
  const activeConflict = ref<ActiveConflict | null>(null);

  function unlock(key: Uint8Array, vaultId: string, revision = 0) {
    vaultKey?.fill(0);
    vaultKey = key.slice();
    currentVaultId.value = vaultId;
    headRevision.value = revision;
    hasEncryptedVault.value = true;
    isUnlocked.value = true;
    lastError.value = null;
  }

  function lock() {
    vaultKey?.fill(0);
    vaultKey = undefined;
    isUnlocked.value = false;
  }

  function setSyncStatus(status: SyncStatus) {
    syncStatus.value = status;
  }

  function setHasEncryptedVault(value: boolean) {
    hasEncryptedVault.value = value;
  }

  async function persistEncryptedNote(
    userId: string,
    operation: EncryptedPushOperation,
    head: number,
  ) {
    await putCachedNote(userId, {
      ciphertext: operation.ciphertext,
      ciphertextHash: operation.ciphertext_hash,
      nonce: operation.nonce,
      noteId: operation.note_id,
      revision: operation.base_revision,
      vaultId: operation.vault_id,
    });
    await setCachedHeadRevision(userId, operation.vault_id, head);
  }

  async function loadNotesFromCache(userId: string, vaultId: string) {
    if (!vaultKey) {
      throw new Error("Vault is locked");
    }
    notes.clear();
    const cached = await listCachedNotes(userId, vaultId);
    for (const record of cached) {
      const plaintext = xchacha20poly1305(
        vaultKey,
        Uint8Array.from(record.nonce),
        aad(record.vaultId, record.noteId, record.revision),
      ).decrypt(Uint8Array.from(record.ciphertext));
      notes.set(record.noteId, {
        content: new TextDecoder().decode(plaintext),
        revision: record.revision,
      });
    }
    headRevision.value = await getCachedHeadRevision(userId, vaultId);
    syncStatus.value = "offline";
  }

  async function listVaultIds(): Promise<string[]> {
    try {
      const response = await fetch("/v1/vaults", { credentials: "include" });
      if (!response.ok) {
        throw new Error("Unable to list vaults");
      }
      const body = (await response.json()) as { vaults: { id: string }[] };
      return body.vaults.map((vault) => vault.id);
    } catch {
      const userId = useAuthStore().userId;
      if (!userId) {
        throw new Error("Unable to list vaults");
      }
      return listCachedVaultIds(userId);
    }
  }

  async function createVault(): Promise<string> {
    const response = await fetch("/vaults", {
      body: "{}",
      credentials: "include",
      headers: csrfHeaders(),
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("Unable to create vault");
    }
    const body = (await response.json()) as { id: string };
    hasEncryptedVault.value = true;
    return body.id;
  }

  async function putEnvelope(vaultId: string, bytes: number[]) {
    const response = await fetch(`/v1/vaults/${vaultId}/envelope`, {
      body: JSON.stringify({ bytes }),
      credentials: "include",
      headers: csrfHeaders(),
      method: "PUT",
    });
    if (!response.ok) {
      throw new Error("Unable to store vault envelope");
    }
    const userId = useAuthStore().userId;
    if (userId) {
      await putCachedEnvelope(userId, vaultId, bytes);
    }
  }

  async function createAndUnlockVault(passphrase: string): Promise<string> {
    const vaultId = await createVault();
    const { envelope, vaultKey: key } = await createWrappedVaultKey(passphrase);
    await putEnvelope(vaultId, encodeWrappedVaultKey(envelope));
    unlock(key, vaultId, 0);
    notes.clear();
    return vaultId;
  }

  async function fetchEnvelopeBytes(vaultId: string): Promise<number[]> {
    try {
      const response = await fetch(`/v1/vaults/${vaultId}/envelope`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Unable to load vault envelope");
      }
      const body = (await response.json()) as { bytes: number[] };
      hasEncryptedVault.value = true;
      const userId = useAuthStore().userId;
      if (userId) {
        await putCachedEnvelope(userId, vaultId, body.bytes);
      }
      return body.bytes;
    } catch {
      const userId = useAuthStore().userId;
      if (!userId) {
        throw new Error("Unable to load vault envelope");
      }
      const cached = await getCachedEnvelope(userId, vaultId);
      if (!cached) {
        throw new Error("Unable to load vault envelope");
      }
      hasEncryptedVault.value = true;
      return cached;
    }
  }

  async function loadNotes(vaultId: string) {
    if (!vaultKey) {
      throw new Error("Vault is locked");
    }
    const userId = requireUserId();
    let cursor: string | null = null;
    notes.clear();
    let maxBase = 0;
    for (;;) {
      const path = buildPullOperationsPath(vaultId, { cursor, limit: 100 });
      let response: Response;
      try {
        response = await fetch(path, { credentials: "include" });
      } catch {
        await loadNotesFromCache(userId, vaultId);
        return;
      }
      if (response.status === 409) {
        cursor = null;
        notes.clear();
        maxBase = 0;
        continue;
      }
      if (!response.ok) {
        syncStatus.value = "error";
        return;
      }
      const page = (await response.json()) as PullResponse;
      for (const operation of page.operations) {
        maxBase = Math.max(maxBase, operation.base_revision);
        const plaintext = xchacha20poly1305(
          vaultKey,
          Uint8Array.from(operation.nonce),
          aad(operation.vault_id, operation.note_id, operation.base_revision),
        ).decrypt(Uint8Array.from(operation.ciphertext));
        notes.set(operation.note_id, {
          content: new TextDecoder().decode(plaintext),
          revision: operation.base_revision,
        });
        await putCachedNote(userId, {
          ciphertext: operation.ciphertext,
          ciphertextHash: operation.ciphertext_hash,
          nonce: operation.nonce,
          noteId: operation.note_id,
          revision: operation.base_revision,
          vaultId: operation.vault_id,
        });
      }
      pullCursor.value = page.next_cursor;
      await setCachedPullCursor(userId, vaultId, page.next_cursor);
      if (!page.next_cursor) {
        headRevision.value = notes.size === 0 ? 0 : maxBase + 1;
        await setCachedHeadRevision(userId, vaultId, headRevision.value);
        syncStatus.value = "synced";
        return;
      }
      cursor = page.next_cursor;
    }
  }

  function decryptOperation(operation: EncryptedPushOperation): string {
    if (!vaultKey) {
      throw new Error("Vault is locked");
    }
    const plaintext = xchacha20poly1305(
      vaultKey,
      Uint8Array.from(operation.nonce),
      aad(operation.vault_id, operation.note_id, operation.base_revision),
    ).decrypt(Uint8Array.from(operation.ciphertext));
    return new TextDecoder().decode(plaintext);
  }

  async function pullAllOperations(
    vaultId: string,
  ): Promise<EncryptedPushOperation[]> {
    const operations: EncryptedPushOperation[] = [];
    let cursor: string | null = null;
    for (;;) {
      const path = buildPullOperationsPath(vaultId, { cursor, limit: 100 });
      const response = await fetch(path, { credentials: "include" });
      if (!response.ok) {
        throw new Error("Unable to pull conflict variants");
      }
      const page = (await response.json()) as PullResponse;
      operations.push(...page.operations);
      if (!page.next_cursor) {
        return operations;
      }
      cursor = page.next_cursor;
    }
  }

  async function materializeConflict(
    operation: EncryptedPushOperation,
    conflict: Conflict,
  ) {
    const local = decryptOperation(operation);
    const pulled = await pullAllOperations(operation.vault_id);
    const byHash = new Map(
      pulled.map((item) => [item.ciphertext_hash, item] as const),
    );
    const baseOp = byHash.get(conflict.base_ciphertext_hash);
    const remoteOp = byHash.get(conflict.remote_ciphertext_hash);
    if (!baseOp || !remoteOp) {
      throw new Error("Missing conflict ciphertext variants");
    }
    activeConflict.value = {
      base: decryptOperation(baseOp),
      conflict,
      local,
      manualDraft: local,
      noteId: conflict.note_id,
      remote: decryptOperation(remoteOp),
    };
    headRevision.value = conflict.remote_revision;
    syncStatus.value = "conflict";
    lastError.value = "Conflit de révision.";
  }

  async function handleConflictResponse(
    operation: EncryptedPushOperation,
    response: Response,
  ): Promise<boolean> {
    const body = (await response.json()) as Conflict & {
      code?: string;
    };
    if (body.code === "sync_cursor_resnapshot_required") {
      syncStatus.value = "error";
      lastError.value = "Curseur de synchronisation invalide.";
      return true;
    }
    if (
      body.protocol_version !== 1 ||
      !body.operation_id ||
      !body.base_ciphertext_hash
    ) {
      syncStatus.value = "conflict";
      lastError.value = "Conflit de révision.";
      return true;
    }
    try {
      await materializeConflict(operation, body);
    } catch {
      syncStatus.value = "conflict";
      lastError.value = "Conflit de révision (variantes indisponibles).";
    }
    return true;
  }

  async function pushOperation(
    operation: EncryptedPushOperation,
  ): Promise<Response> {
    return fetch(`/v1/vaults/${operation.vault_id}/operations`, {
      body: serializeEncryptedPushOperation(operation),
      credentials: "include",
      headers: csrfHeaders(),
      method: "POST",
    });
  }

  async function flushPendingOperations(): Promise<void> {
    if (!currentVaultId.value) {
      return;
    }
    const userId = requireUserId();
    const vaultId = currentVaultId.value;
    const pending = await listPendingOperations(userId, vaultId);
    for (const operation of pending) {
      try {
        const response = await pushOperation(operation);
        if (response.status === 409) {
          await handleConflictResponse(operation, response);
          return;
        }
        if (!response.ok) {
          syncStatus.value = "error";
          lastError.value = `Enregistrement refusé (${response.status}).`;
          return;
        }
        const ack = (await response.json()) as { revision: number };
        headRevision.value = ack.revision;
        await removeAckedOperation(userId, operation.operation_id);
        await persistEncryptedNote(userId, operation, ack.revision);
        const local = notes.get(operation.note_id);
        if (local) {
          notes.set(operation.note_id, {
            content: local.content,
            revision: ack.revision,
          });
        }
      } catch {
        syncStatus.value = "offline";
        lastError.value = "Hors ligne.";
        return;
      }
    }
    if (pending.length > 0) {
      syncStatus.value = "synced";
      lastError.value = null;
    }
  }

  async function saveNote(input: NoteInput) {
    if (!vaultKey || !currentVaultId.value) {
      lastError.value = "Coffre verrouillé ou absent.";
      syncStatus.value = "error";
      throw new Error("Vault is locked");
    }
    const userId = requireUserId();
    const vaultId = currentVaultId.value;
    const baseRevision = headRevision.value;
    notes.set(input.id, {
      content: input.content,
      revision: baseRevision,
    });
    syncStatus.value = "saving";
    lastError.value = null;

    const nonce = randomNonce();
    const ciphertext = xchacha20poly1305(
      vaultKey,
      nonce,
      aad(vaultId, input.id, baseRevision),
    ).encrypt(new TextEncoder().encode(input.content));
    const operation: EncryptedPushOperation = {
      aad_version: 1,
      base_revision: baseRevision,
      ciphertext: Array.from(ciphertext),
      ciphertext_hash: bytesToHex(sha256(ciphertext)),
      nonce: Array.from(nonce),
      note_id: input.id,
      operation_id: uuidV7(),
      protocol_version: 1,
      vault_id: vaultId,
    };

    await persistEncryptedNote(userId, operation, baseRevision);

    try {
      const response = await pushOperation(operation);
      if (response.status === 409) {
        await handleConflictResponse(operation, response);
      } else if (!response.ok) {
        syncStatus.value = "error";
        lastError.value = `Enregistrement refusé (${response.status}).`;
      } else {
        const ack = (await response.json()) as { revision: number };
        headRevision.value = ack.revision;
        notes.set(input.id, {
          content: input.content,
          revision: ack.revision,
        });
        await persistEncryptedNote(userId, operation, ack.revision);
        await removeAckedOperation(userId, operation.operation_id);
        syncStatus.value = "synced";
      }
    } catch {
      await enqueueOperation(userId, operation);
      syncStatus.value = "offline";
      lastError.value = "Hors ligne.";
    }

    return operation;
  }

  async function resolveConflict(content: string) {
    const current = activeConflict.value;
    if (!current || !vaultKey || !currentVaultId.value) {
      throw new Error("No active conflict");
    }
    const userId = requireUserId();
    const expected = current.conflict;
    const vaultId = currentVaultId.value;
    const baseRevision = expected.remote_revision;
    headRevision.value = baseRevision;
    activeConflict.value = null;

    const pending = await listPendingOperations(userId, vaultId);
    for (const operation of pending) {
      if (operation.note_id === current.noteId) {
        await removeAckedOperation(userId, operation.operation_id);
      }
    }

    const result = await saveNote({ content, id: current.noteId });
    if (
      syncStatus.value === "synced" &&
      result.base_revision === expected.remote_revision &&
      result.ciphertext_hash
    ) {
      lastError.value = null;
    }
    return {
      conflict_id: expected.operation_id,
      expected_base_hash: expected.base_ciphertext_hash,
      expected_local_hash: expected.local_ciphertext_hash,
      expected_remote_hash: expected.remote_ciphertext_hash,
      resolved_operation_id: result.operation_id,
    };
  }

  async function clearDeviceData() {
    const userId = useAuthStore().userId;
    if (userId) {
      await clearUserOfflineData(userId);
    }
    lock();
    notes.clear();
    hasEncryptedVault.value = false;
    currentVaultId.value = null;
    headRevision.value = 0;
    pullCursor.value = null;
    activeConflict.value = null;
  }

  return {
    activeConflict,
    clearDeviceData,
    createAndUnlockVault,
    currentVaultId,
    fetchEnvelopeBytes,
    flushPendingOperations,
    hasEncryptedVault,
    headRevision,
    isUnlocked,
    lastError,
    listVaultIds,
    loadNotes,
    lock,
    notes,
    pullCursor,
    resolveConflict,
    saveNote,
    setHasEncryptedVault,
    setSyncStatus,
    syncStatus,
    unlock,
  };
});
