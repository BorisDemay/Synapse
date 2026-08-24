import {
  backlinksFor as findBacklinks,
  searchLocalNotes,
  uniqueTags,
} from "@synapse/ui";
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
  unwrapAssistantConversations,
  wrapAssistantConversations,
  type AssistantConversationSnapshot,
} from "../crypto/ai-conversation";
import {
  unwrapAssistantCredential,
  wrapAssistantCredential,
  type AssistantCredential,
} from "../crypto/ai-credential";
import {
  createTrustedDevice,
  isTrustedDeviceSupported,
  unlockTrustedDevice,
} from "../crypto/trusted-device";
import {
  decodeVaultItem,
  decodedNoteMarkdown,
  encodeNotePlaintext,
  encodeVaultItem,
  isBlockedAttachmentPath,
  legacyWebNotePath,
  MAX_ITEM_BYTES,
} from "../crypto/vault-item";
import {
  createWrappedVaultKey,
  encodeWrappedVaultKey,
  parseWrappedVaultKey,
  unlockVaultKey,
  uuidV7,
  wrapVaultKey,
} from "../crypto/vault-key";
import {
  clearUserOfflineData,
  deleteAssistantCredential,
  deleteTrustedDevice,
  getAssistantCredential,
  getAssistantConversations,
  getCachedEnvelope,
  getCachedHeadRevision,
  getTrustedDevice,
  listCachedNotes,
  listCachedVaultIds,
  listNoteRevisions,
  putAssistantCredential,
  putAssistantConversations,
  putCachedEnvelope,
  putCachedNote,
  putNoteRevision,
  putTrustedDevice,
  getVaultPreferences,
  putVaultPreferences,
  setCachedHeadRevision,
  setCachedPullCursor,
} from "../offline/cache";
import {
  DEFAULT_VAULT_PREFERENCES,
  unwrapVaultPreferences,
  wrapVaultPreferences,
  type VaultPreferences,
} from "../crypto/vault-preferences";
import { dailyNotePath, renderTemplate } from "@synapse/ui";
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
  path?: string;
}

interface LocalNote {
  content: string;
  path?: string;
  revision: number;
}

interface LocalAttachment {
  bytes: Uint8Array;
  contentType: string;
  path: string;
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

const SKIP_TRUSTED_UNLOCK_KEY = "synapse-skip-trusted-unlock";
const DELETED_NOTE_SENTINEL = "\u0000synapse/deleted";

function csrfHeaders(): HeadersInit {
  return {
    Origin: window.location.origin,
    "content-type": "application/json",
  };
}

function persistSkipTrustedUnlock(skip: boolean) {
  try {
    if (skip) {
      sessionStorage.setItem(SKIP_TRUSTED_UNLOCK_KEY, "1");
      return;
    }
    sessionStorage.removeItem(SKIP_TRUSTED_UNLOCK_KEY);
  } catch {
    // sessionStorage is unavailable in some test stubs.
  }
}

function sessionSkipTrustedUnlock(): boolean {
  try {
    return sessionStorage.getItem(SKIP_TRUSTED_UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

function requireUserId(): string {
  const userId = useAuthStore().userId;
  if (!userId) {
    throw new Error("Missing authenticated user");
  }
  return userId;
}

function keysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function noteExportTitle(markdown: string, fallback: string): string {
  const heading = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));
  if (heading) {
    return heading.replace(/^#+\s+/, "").trim() || fallback;
  }
  const firstLine = markdown
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine?.slice(0, 48) || fallback;
}

function isDeletedNoteContent(content: string): boolean {
  return content === DELETED_NOTE_SENTINEL;
}

function pathForNote(id: string, existing?: LocalNote): string {
  return existing?.path || legacyWebNotePath(id);
}

function applyPlaintext(
  noteId: string,
  plaintext: Uint8Array,
  revision: number,
  notes: Map<string, LocalNote>,
  attachments: Map<string, LocalAttachment>,
) {
  const asText = new TextDecoder().decode(plaintext);
  if (
    isDeletedNoteContent(asText) ||
    asText.startsWith("\u0000synapse/deleted")
  ) {
    notes.delete(noteId);
    attachments.delete(noteId);
    return;
  }
  const decoded = decodeVaultItem(plaintext);
  if (decoded.kind === "attachment") {
    notes.delete(noteId);
    attachments.set(noteId, {
      bytes: decoded.bytes,
      contentType: decoded.contentType,
      path: decoded.path,
      revision,
    });
    return;
  }
  attachments.delete(noteId);
  notes.set(noteId, {
    content: decoded.markdown,
    path: decoded.kind === "note" ? decoded.path : pathForNote(noteId),
    revision,
  });
}

export const useVaultStore = defineStore("vault", () => {
  let vaultKey: Uint8Array | undefined;
  const notes = reactive(new Map<string, LocalNote>());
  const attachments = reactive(new Map<string, LocalAttachment>());
  const historyByNote = reactive(
    new Map<
      string,
      { content: string; recordedAt: string; revision: number }[]
    >(),
  );
  const pendingNoteIds = ref<string[]>([]);
  const syncStatus = ref<SyncStatus>("synced");
  const hasEncryptedVault = ref(false);
  const isUnlocked = ref(false);
  const currentVaultId = ref<string | null>(null);
  const headRevision = ref(0);
  const pullCursor = ref<string | null>(null);
  const lastError = ref<string | null>(null);
  const activeConflict = ref<ActiveConflict | null>(null);
  const preferences = ref<VaultPreferences>({ ...DEFAULT_VAULT_PREFERENCES });
  const skipTrustedUnlock = ref(sessionSkipTrustedUnlock());

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
    attachments.clear();
    historyByNote.clear();
    pendingNoteIds.value = [];
  }

  function allowTrustedUnlock() {
    skipTrustedUnlock.value = false;
    persistSkipTrustedUnlock(false);
  }

  function lockAndRequirePassphrase() {
    lock();
    skipTrustedUnlock.value = true;
    persistSkipTrustedUnlock(true);
  }

  function shouldSkipTrustedUnlock() {
    return skipTrustedUnlock.value || sessionSkipTrustedUnlock();
  }

  function requireUnlockedVault(): { key: Uint8Array; vaultId: string } {
    if (!vaultKey || !currentVaultId.value) {
      throw new Error("Vault is locked");
    }
    return { key: vaultKey, vaultId: currentVaultId.value };
  }

  async function loadPreferences(
    userId: string,
    vaultId: string,
  ): Promise<void> {
    if (!vaultKey) {
      return;
    }
    const record = await getVaultPreferences(userId, vaultId);
    if (!record) {
      preferences.value = { ...DEFAULT_VAULT_PREFERENCES };
      return;
    }
    preferences.value = unwrapVaultPreferences(vaultKey, vaultId, record);
  }

  async function savePreferences(next: VaultPreferences): Promise<void> {
    const { key, vaultId } = requireUnlockedVault();
    const userId = requireUserId();
    const envelope = wrapVaultPreferences(key, vaultId, next);
    await putVaultPreferences({ ...envelope, userId, vaultId });
    preferences.value = {
      ...next,
      pinnedNoteIds: [...next.pinnedNoteIds],
      savedSearches: next.savedSearches.map((search) => ({ ...search })),
    };
  }

  async function createDailyNote(templateId?: string): Promise<string> {
    const path = dailyNotePath(new Date(), preferences.value.dailyNotePattern);
    const existing = [...notes.entries()].find(
      ([, note]) => note.path === path,
    );
    if (existing) {
      return existing[0];
    }
    const template = templateId ? notes.get(templateId) : undefined;
    const title = path.split("/").pop()?.replace(/\.md$/iu, "") ?? "Daily";
    const content = renderTemplate(template?.content ?? `# ${title}\n\n`, {
      date: new Date(),
      title,
    });
    const id = uuidV7();
    await saveNote({ content, id, path });
    return id;
  }

  async function togglePinnedNote(id: string): Promise<void> {
    const pinned = preferences.value.pinnedNoteIds;
    await savePreferences({
      ...preferences.value,
      pinnedNoteIds: pinned.includes(id)
        ? pinned.filter((entry) => entry !== id)
        : [...pinned, id],
    });
  }

  async function persistAssistantCredential(
    credential: AssistantCredential,
  ): Promise<void> {
    const { key, vaultId } = requireUnlockedVault();
    const envelope = wrapAssistantCredential(key, vaultId, credential);
    await putAssistantCredential({
      ciphertext: envelope.ciphertext,
      nonce: envelope.nonce,
      provider: "codex",
      userId: requireUserId(),
      vaultId,
    });
  }

  async function loadAssistantCredential(): Promise<AssistantCredential | null> {
    const { key, vaultId } = requireUnlockedVault();
    const record = await getAssistantCredential(requireUserId(), vaultId);
    if (!record) {
      return null;
    }
    return unwrapAssistantCredential(key, vaultId, {
      ciphertext: record.ciphertext,
      nonce: record.nonce,
    });
  }

  async function forgetAssistantCredential(): Promise<void> {
    if (!currentVaultId.value) {
      return;
    }
    const userId = useAuthStore().userId;
    if (!userId) {
      return;
    }
    await deleteAssistantCredential(userId, currentVaultId.value);
  }

  async function persistAssistantConversations(
    snapshot: AssistantConversationSnapshot,
  ): Promise<void> {
    const { key, vaultId } = requireUnlockedVault();
    const envelope = wrapAssistantConversations(key, vaultId, snapshot);
    await putAssistantConversations({
      ciphertext: envelope.ciphertext,
      nonce: envelope.nonce,
      userId: requireUserId(),
      vaultId,
    });
  }

  async function loadAssistantConversations(): Promise<AssistantConversationSnapshot | null> {
    const { key, vaultId } = requireUnlockedVault();
    const record = await getAssistantConversations(requireUserId(), vaultId);
    if (!record) {
      return null;
    }
    return unwrapAssistantConversations(key, vaultId, {
      ciphertext: record.ciphertext,
      nonce: record.nonce,
    });
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

  async function refreshPending() {
    if (!currentVaultId.value) {
      pendingNoteIds.value = [];
      return;
    }
    try {
      const pending = await listPendingOperations(
        requireUserId(),
        currentVaultId.value,
      );
      pendingNoteIds.value = [
        ...new Set(pending.map((operation) => operation.note_id)),
      ];
    } catch {
      pendingNoteIds.value = [];
    }
  }

  function queryNotes() {
    return Array.from(notes.entries()).map(([id, note]) => ({
      content: note.content,
      id,
      label: noteExportTitle(note.content, id.slice(0, 8)),
      path: note.path || legacyWebNotePath(id),
    }));
  }

  async function rememberHistory(
    userId: string,
    operation: EncryptedPushOperation,
    content: string,
    revision: number,
  ) {
    if (isDeletedNoteContent(content)) {
      return;
    }
    const recordedAt = new Date().toISOString();
    const previous = historyByNote.get(operation.note_id) ?? [];
    previous.unshift({ content, recordedAt, revision });
    historyByNote.set(operation.note_id, previous.slice(0, 50));
    await putNoteRevision({
      baseRevision: operation.base_revision,
      ciphertext: operation.ciphertext,
      nonce: operation.nonce,
      noteId: operation.note_id,
      recordedAt,
      revision,
      userId,
      vaultId: operation.vault_id,
    });
  }

  async function hydrateHistory(userId: string, vaultId: string) {
    if (!vaultKey) {
      return;
    }
    historyByNote.clear();
    for (const noteId of notes.keys()) {
      const records = await listNoteRevisions(userId, vaultId, noteId);
      const entries: {
        content: string;
        recordedAt: string;
        revision: number;
      }[] = [];
      for (const record of records) {
        try {
          const plaintext = xchacha20poly1305(
            vaultKey,
            Uint8Array.from(record.nonce),
            aad(record.vaultId, record.noteId, record.baseRevision),
          ).decrypt(Uint8Array.from(record.ciphertext));
          const markdown = decodedNoteMarkdown(decodeVaultItem(plaintext));
          if (markdown && !isDeletedNoteContent(markdown)) {
            entries.push({
              content: markdown,
              recordedAt: record.recordedAt,
              revision: record.revision,
            });
          }
        } catch {
          // Skip revisions that cannot be decrypted with the current key.
        }
      }
      historyByNote.set(noteId, entries);
    }
  }

  async function loadNotesFromCache(userId: string, vaultId: string) {
    if (!vaultKey) {
      throw new Error("Vault is locked");
    }
    notes.clear();
    attachments.clear();
    const cached = await listCachedNotes(userId, vaultId);
    for (const record of cached) {
      const plaintext = xchacha20poly1305(
        vaultKey,
        Uint8Array.from(record.nonce),
        aad(record.vaultId, record.noteId, record.revision),
      ).decrypt(Uint8Array.from(record.ciphertext));
      applyPlaintext(
        record.noteId,
        plaintext,
        record.revision,
        notes,
        attachments,
      );
    }
    headRevision.value = await getCachedHeadRevision(userId, vaultId);
    syncStatus.value = "offline";
    await hydrateHistory(userId, vaultId);
    await loadPreferences(userId, vaultId);
    await refreshPending();
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
    key.fill(0);
    notes.clear();
    attachments.clear();
    return vaultId;
  }

  async function unlockWithTrustedDevice(vaultId: string): Promise<boolean> {
    const userId = requireUserId();
    const record = await getTrustedDevice(userId, vaultId);
    if (!record) {
      return false;
    }
    const key = await unlockTrustedDevice(record);
    try {
      unlock(key, vaultId, 0);
      await loadNotes(vaultId);
    } catch (error) {
      lock();
      throw error;
    } finally {
      key.fill(0);
    }
    return true;
  }

  async function hasTrustedDevice(vaultId: string): Promise<boolean> {
    const userId = requireUserId();
    return Boolean(await getTrustedDevice(userId, vaultId));
  }

  async function rememberCurrentDevice(): Promise<void> {
    if (!vaultKey || !currentVaultId.value) {
      throw new Error("Vault is locked");
    }
    const userId = requireUserId();
    const record = await createTrustedDevice(
      userId,
      currentVaultId.value,
      vaultKey,
    );
    await putTrustedDevice(record);
  }

  async function forgetTrustedDevice(vaultId: string): Promise<void> {
    const userId = requireUserId();
    const record = await getTrustedDevice(userId, vaultId);
    if (record) {
      await deleteTrustedDevice(record);
    }
  }

  async function changePassphrase(
    currentPassphrase: string,
    nextPassphrase: string,
  ): Promise<void> {
    if (!vaultKey || !currentVaultId.value) {
      throw new Error("Vault is locked");
    }
    if (!nextPassphrase) {
      throw new Error("Unable to unlock vault");
    }
    const bytes = await fetchEnvelopeBytes(currentVaultId.value);
    const envelope = parseWrappedVaultKey(bytes);
    const unlocked = await unlockVaultKey(envelope, currentPassphrase);
    try {
      if (!keysEqual(unlocked, vaultKey)) {
        throw new Error("Unable to unlock vault");
      }
      const nextEnvelope = await wrapVaultKey(vaultKey, nextPassphrase);
      await putEnvelope(
        currentVaultId.value,
        encodeWrappedVaultKey(nextEnvelope),
      );
    } finally {
      unlocked.fill(0);
    }
  }

  function markdownExportNotes(): {
    content: string;
    path?: string;
    title: string;
  }[] {
    return Array.from(notes.entries())
      .filter(([, note]) => !isDeletedNoteContent(note.content))
      .map(([id, note]) => ({
        content: note.content,
        ...(note.path ? { path: note.path } : {}),
        title: noteExportTitle(note.content, id.slice(0, 8)),
      }));
  }

  function markdownExportAttachments(): {
    bytes: Uint8Array;
    path: string;
  }[] {
    return Array.from(attachments.values()).map((file) => ({
      bytes: file.bytes,
      path: file.path,
    }));
  }

  async function tryUnlockFromTrustedDevice(): Promise<boolean> {
    if (skipTrustedUnlock.value || sessionSkipTrustedUnlock()) {
      return false;
    }
    if (!isTrustedDeviceSupported()) {
      return false;
    }
    try {
      const ids = await listVaultIds();
      const vaultId = ids[0];
      if (!vaultId) {
        return false;
      }
      setHasEncryptedVault(true);
      if (!(await hasTrustedDevice(vaultId))) {
        return false;
      }
      await unlockWithTrustedDevice(vaultId);
      return true;
    } catch {
      return false;
    }
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
    attachments.clear();
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
        attachments.clear();
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
        applyPlaintext(
          operation.note_id,
          plaintext,
          operation.base_revision,
          notes,
          attachments,
        );
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
        await hydrateHistory(userId, vaultId);
        await loadPreferences(userId, vaultId);
        await refreshPending();
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
    const asText = new TextDecoder().decode(plaintext);
    if (isDeletedNoteContent(asText)) {
      return asText;
    }
    const markdown = decodedNoteMarkdown(decodeVaultItem(plaintext));
    if (markdown === null) {
      throw new Error("Missing conflict ciphertext variants");
    }
    return markdown;
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
            path: local.path,
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
    await refreshPending();
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
    const path = input.path ?? pathForNote(input.id, notes.get(input.id));
    if (!isDeletedNoteContent(input.content)) {
      notes.set(input.id, {
        content: input.content,
        path,
        revision: baseRevision,
      });
    }
    syncStatus.value = "saving";
    lastError.value = null;

    const nonce = randomNonce();
    const plaintext = isDeletedNoteContent(input.content)
      ? new TextEncoder().encode(input.content)
      : encodeNotePlaintext(path, input.content);
    const ciphertext = xchacha20poly1305(
      vaultKey,
      nonce,
      aad(vaultId, input.id, baseRevision),
    ).encrypt(plaintext);
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
        if (!isDeletedNoteContent(input.content)) {
          notes.set(input.id, {
            content: input.content,
            path,
            revision: ack.revision,
          });
        }
        await rememberHistory(userId, operation, input.content, ack.revision);
        await persistEncryptedNote(userId, operation, ack.revision);
        await removeAckedOperation(userId, operation.operation_id);
        syncStatus.value = "synced";
        await refreshPending();
      }
    } catch {
      await enqueueOperation(userId, operation);
      pendingNoteIds.value = [...new Set([...pendingNoteIds.value, input.id])];
      await rememberHistory(userId, operation, input.content, baseRevision + 1);
      syncStatus.value = "offline";
      lastError.value = "Hors ligne.";
    }

    return operation;
  }

  async function pushPlaintext(noteId: string, plaintext: Uint8Array) {
    if (!vaultKey || !currentVaultId.value) {
      throw new Error("Vault is locked");
    }
    const userId = requireUserId();
    const vaultId = currentVaultId.value;
    const baseRevision = headRevision.value;
    syncStatus.value = "saving";
    lastError.value = null;
    const nonce = randomNonce();
    const ciphertext = xchacha20poly1305(
      vaultKey,
      nonce,
      aad(vaultId, noteId, baseRevision),
    ).encrypt(plaintext);
    const operation: EncryptedPushOperation = {
      aad_version: 1,
      base_revision: baseRevision,
      ciphertext: Array.from(ciphertext),
      ciphertext_hash: bytesToHex(sha256(ciphertext)),
      nonce: Array.from(nonce),
      note_id: noteId,
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
        await persistEncryptedNote(userId, operation, ack.revision);
        await removeAckedOperation(userId, operation.operation_id);
        syncStatus.value = "synced";
        await refreshPending();
        return { operation, revision: ack.revision };
      }
    } catch {
      await enqueueOperation(userId, operation);
      pendingNoteIds.value = [...new Set([...pendingNoteIds.value, noteId])];
      syncStatus.value = "offline";
      lastError.value = "Hors ligne.";
    }
    return { operation, revision: baseRevision };
  }

  async function saveAttachment(input: {
    bytes: Uint8Array;
    contentType: string;
    id?: string;
    path: string;
  }) {
    if (
      isBlockedAttachmentPath(input.path) ||
      input.bytes.byteLength > MAX_ITEM_BYTES
    ) {
      throw new Error("Invalid attachment");
    }
    const existing = [...attachments.entries()].find(
      ([, file]) => file.path === input.path,
    );
    const id = input.id ?? existing?.[0] ?? uuidV7();
    const plaintext = encodeVaultItem({
      bytes: input.bytes,
      contentType: input.contentType,
      kind: "attachment",
      path: input.path,
    });
    attachments.set(id, {
      bytes: input.bytes,
      contentType: input.contentType,
      path: input.path,
      revision: headRevision.value,
    });
    const result = await pushPlaintext(id, plaintext);
    attachments.set(id, {
      bytes: input.bytes,
      contentType: input.contentType,
      path: input.path,
      revision: result.revision,
    });
    return result.operation;
  }

  function searchNotes(query: string) {
    return searchLocalNotes(queryNotes(), query);
  }

  function backlinksForNote(id: string) {
    const current = notes.get(id);
    if (!current) {
      return [];
    }
    return findBacklinks(queryNotes(), {
      content: current.content,
      id,
      label: noteExportTitle(current.content, id.slice(0, 8)),
      path: current.path || legacyWebNotePath(id),
    });
  }

  function historyFor(id: string) {
    return historyByNote.get(id) ?? [];
  }

  function listedTags() {
    return uniqueTags(queryNotes());
  }

  async function restoreRevision(id: string, revision: number) {
    const entry = historyFor(id).find((item) => item.revision === revision);
    if (!entry) {
      throw new Error("Revision is missing");
    }
    return saveNote({ content: entry.content, id });
  }

  async function renameNote(id: string, path: string) {
    const current = notes.get(id);
    if (!current) {
      throw new Error("Note is missing");
    }
    return saveNote({ content: current.content, id, path });
  }

  function noteSyncStatus(
    id: string,
  ): "conflict" | "error" | "offline" | "pending" | "synced" {
    if (activeConflict.value?.noteId === id) {
      return "conflict";
    }
    if (pendingNoteIds.value.includes(id)) {
      return "pending";
    }
    if (syncStatus.value === "error") {
      return "error";
    }
    return syncStatus.value === "offline" ? "offline" : "synced";
  }

  async function deleteNote(id: string) {
    try {
      return await saveNote({ content: DELETED_NOTE_SENTINEL, id });
    } finally {
      notes.delete(id);
      attachments.delete(id);
    }
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
    attachments.clear();
    hasEncryptedVault.value = false;
    currentVaultId.value = null;
    headRevision.value = 0;
    pullCursor.value = null;
    activeConflict.value = null;
  }

  return {
    activeConflict,
    allowTrustedUnlock,
    changePassphrase,
    clearDeviceData,
    createAndUnlockVault,
    currentVaultId,
    deleteNote,
    fetchEnvelopeBytes,
    flushPendingOperations,
    forgetAssistantCredential,
    forgetTrustedDevice,
    hasEncryptedVault,
    hasTrustedDevice,
    headRevision,
    isUnlocked,
    lastError,
    listVaultIds,
    loadAssistantCredential,
    loadAssistantConversations,
    loadNotes,
    lock,
    lockAndRequirePassphrase,
    attachments,
    backlinksForNote,
    historyFor,
    listedTags,
    markdownExportAttachments,
    markdownExportNotes,
    noteSyncStatus,
    notes,
    pendingNoteIds,
    preferences,
    persistAssistantCredential,
    persistAssistantConversations,
    pullCursor,
    rememberCurrentDevice,
    renameNote,
    resolveConflict,
    restoreRevision,
    saveAttachment,
    savePreferences,
    saveNote,
    searchNotes,
    setHasEncryptedVault,
    setSyncStatus,
    shouldSkipTrustedUnlock,
    syncStatus,
    tryUnlockFromTrustedDevice,
    createDailyNote,
    togglePinnedNote,
    unlock,
    unlockWithTrustedDevice,
  };
});
