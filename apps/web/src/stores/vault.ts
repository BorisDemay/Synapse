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
  commitPulledPage,
  getCachedPullCursor,
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
  putTrustedDevice,
  getVaultPreferences,
  putVaultPreferences,
  setCachedPullCursor,
} from "../offline/cache";
import {
  DEFAULT_VAULT_PREFERENCES,
  unwrapVaultPreferences,
  wrapVaultPreferences,
  type VaultPreferences,
} from "../crypto/vault-preferences";
import {
  persistPendingOperation,
  prepareOperation,
  acknowledgeOperation,
  blockConflictedOperation,
  getOperationConflict,
  listPendingOperations,
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
  return existing?.path || `${id}.md`;
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
  const syncControllers = new Set<AbortController>();
  let localEditEpoch = 0;
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
    for (const controller of syncControllers) controller.abort();
    vaultKey?.fill(0);
    vaultKey = undefined;
    isUnlocked.value = false;
    notes.clear();
    activeConflict.value = null;
    attachments.clear();
    historyByNote.clear();
    preferences.value = { ...DEFAULT_VAULT_PREFERENCES };
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
    const key = vaultKey;
    const record = await getVaultPreferences(userId, vaultId);
    if (
      vaultKey !== key ||
      currentVaultId.value !== vaultId ||
      useAuthStore().userId !== userId
    )
      return;
    if (!record) {
      preferences.value = { ...DEFAULT_VAULT_PREFERENCES };
      return;
    }
    preferences.value = unwrapVaultPreferences(key, vaultId, record);
  }

  async function savePreferences(next: VaultPreferences): Promise<void> {
    const { key, vaultId } = requireUnlockedVault();
    const userId = requireUserId();
    const envelope = wrapVaultPreferences(key, vaultId, next);
    await putVaultPreferences({ ...envelope, userId, vaultId });
    preferences.value = {
      ...next,
      pinnedNoteIds: [...next.pinnedNoteIds],
      recentNoteIds: [...next.recentNoteIds],
      restorePoints: next.restorePoints.map((point) => ({ ...point })),
      savedSearches: next.savedSearches.map((search) => ({ ...search })),
    };
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

  async function rememberRecentNote(id: string): Promise<void> {
    await savePreferences({
      ...preferences.value,
      recentNoteIds: [
        id,
        ...preferences.value.recentNoteIds.filter((entry) => entry !== id),
      ].slice(0, 20),
    });
  }

  async function createRestorePoint(
    noteId: string,
    label: string,
  ): Promise<void> {
    const key = vaultKey;
    const vaultId = currentVaultId.value;
    const userId = useAuthStore().userId;
    await loadHistory(noteId);
    if (
      !key ||
      vaultKey !== key ||
      currentVaultId.value !== vaultId ||
      useAuthStore().userId !== userId
    )
      throw new Error("Vault is locked");
    const revision =
      historyFor(noteId)[0]?.revision ?? notes.get(noteId)?.revision;
    if (!revision || !label.trim()) {
      throw new Error("Unable to create restore point");
    }
    await savePreferences({
      ...preferences.value,
      restorePoints: [
        {
          id: uuidV7(),
          label: label.trim(),
          noteId,
          recordedAt: new Date().toISOString(),
          revision,
        },
        ...preferences.value.restorePoints.filter(
          (point) => !(point.noteId === noteId && point.label === label.trim()),
        ),
      ].slice(0, 50),
    });
  }

  function restorePointsFor(noteId: string) {
    return preferences.value.restorePoints.filter(
      (point) => point.noteId === noteId,
    );
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
  }

  async function loadHistory(noteId: string) {
    if (!vaultKey) {
      return;
    }
    const key = vaultKey;
    const userId = requireUserId();
    const vaultId = currentVaultId.value;
    if (!vaultId || !notes.has(noteId)) return;
    const epoch = localEditEpoch;
    {
      const records = await listNoteRevisions(userId, vaultId, noteId);
      if (
        vaultKey !== key ||
        useAuthStore().userId !== userId ||
        currentVaultId.value !== vaultId ||
        localEditEpoch !== epoch
      )
        return;
      const entries: {
        content: string;
        recordedAt: string;
        revision: number;
      }[] = [];
      for (const record of records) {
        try {
          const plaintext = xchacha20poly1305(
            key,
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
    const key = vaultKey;
    const active = () =>
      vaultKey === key &&
      currentVaultId.value === vaultId &&
      useAuthStore().userId === userId;
    const epoch = localEditEpoch;
    const cached = await listCachedNotes(userId, vaultId);
    if (!active() || epoch !== localEditEpoch) return;
    const loadedNotes = new Map<string, LocalNote>();
    const loadedAttachments = new Map<string, LocalAttachment>();
    let decoded = 0;
    for (const record of cached) {
      const plaintext = xchacha20poly1305(
        key,
        Uint8Array.from(record.nonce),
        aad(record.vaultId, record.noteId, record.revision),
      ).decrypt(Uint8Array.from(record.ciphertext));
      applyPlaintext(
        record.noteId,
        plaintext,
        record.revision,
        loadedNotes,
        loadedAttachments,
      );
      if (++decoded % 256 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!active() || epoch !== localEditEpoch) return;
      }
    }
    if (!active() || epoch !== localEditEpoch) return;
    notes.clear();
    attachments.clear();
    for (const [id, note] of loadedNotes) notes.set(id, note);
    for (const [id, attachment] of loadedAttachments)
      attachments.set(id, attachment);
    const head = await getCachedHeadRevision(userId, vaultId);
    if (!active()) return;
    headRevision.value = Math.max(headRevision.value, head);
    await loadPreferences(userId, vaultId);
    if (!active()) return;
    await refreshPending();
  }

  async function listVaultIds(): Promise<string[]> {
    if (useAuthStore().isLocalMode) return listCachedVaultIds(requireUserId());
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
    if (useAuthStore().isLocalMode) return uuidV7();
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
    if (useAuthStore().isLocalMode) {
      await putCachedEnvelope(requireUserId(), vaultId, bytes);
      return;
    }
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
    path: string;
    title: string;
  }[] {
    return Array.from(notes.entries())
      .filter(([, note]) => !isDeletedNoteContent(note.content))
      .map(([id, note]) => ({
        content: note.content,
        path: pathForNote(id, note),
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
    if (useAuthStore().isLocalMode) {
      const bytes = await getCachedEnvelope(requireUserId(), vaultId);
      if (!bytes) throw new Error("Unable to load vault envelope");
      return bytes;
    }
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

  let loading:
    | { key: Uint8Array | undefined; vaultId: string; promise: Promise<void> }
    | undefined;
  function loadNotes(vaultId: string): Promise<void> {
    if (loading && loading.key === vaultKey && loading.vaultId === vaultId)
      return loading.promise;
    const job = { key: vaultKey, vaultId, promise: Promise.resolve() };
    job.promise = pullNotes(vaultId).finally(() => {
      if (loading === job) loading = undefined;
    });
    loading = job;
    return job.promise;
  }
  async function pullNotes(vaultId: string): Promise<void> {
    if (!vaultKey) throw new Error("Vault is locked");
    const key = vaultKey;
    const userId = requireUserId();
    const active = () =>
      vaultKey === key &&
      currentVaultId.value === vaultId &&
      useAuthStore().userId === userId;
    await loadNotesFromCache(userId, vaultId);
    if (!active()) return;
    if (useAuthStore().isLocalMode) {
      syncStatus.value = "synced";
      return;
    }
    let cursor = await getCachedPullCursor(userId, vaultId);
    const seen = new Set<string>(cursor ? [cursor] : []);
    let reset = false;
    for (;;) {
      if (!active()) return;
      const epoch = localEditEpoch;
      let response: Response;
      try {
        response = await syncRequest(
          buildPullOperationsPath(vaultId, { cursor, limit: 100 }),
        );
      } catch {
        if (active()) {
          syncStatus.value = "offline";
          lastError.value = "Hors ligne.";
        }
        return;
      }
      if (!active()) return;
      if (response.status === 409 && !reset) {
        cursor = null;
        reset = true;
        seen.clear();
        await setCachedPullCursor(userId, vaultId, null);
        continue;
      }
      if (!response.ok) {
        syncStatus.value = "error";
        return;
      }
      const page = (await response.json()) as PullResponse;
      if (!active()) return;
      if (
        page.protocol_version !== 1 ||
        !Array.isArray(page.operations) ||
        (page.next_cursor !== null &&
          (typeof page.next_cursor !== "string" || seen.has(page.next_cursor)))
      )
        throw new Error("Invalid sync page");
      if (page.next_cursor) seen.add(page.next_cursor);
      const decoded = new Map<string, Uint8Array>();
      for (const operation of page.operations) {
        if (operation.vault_id !== vaultId)
          throw new Error("Invalid sync page");
        // Authenticate every item before advancing the durable cursor.
        const plaintext = xchacha20poly1305(
          key,
          Uint8Array.from(operation.nonce),
          aad(vaultId, operation.note_id, operation.base_revision),
        ).decrypt(Uint8Array.from(operation.ciphertext));
        applyPlaintext(
          operation.note_id,
          plaintext,
          operation.base_revision,
          new Map(),
          new Map(),
        );
        decoded.set(operation.operation_id, plaintext);
      }
      await commitPulledPage(
        userId,
        vaultId,
        page.operations,
        page.next_cursor,
      );
      if (!active()) return;
      const pending = new Set(
        (await listPendingOperations(userId, vaultId)).map(
          (operation) => operation.note_id,
        ),
      );
      if (!active()) return;
      if (epoch === localEditEpoch)
        for (const operation of page.operations) {
          if (!pending.has(operation.note_id))
            applyPlaintext(
              operation.note_id,
              decoded.get(operation.operation_id)!,
              operation.base_revision,
              notes,
              attachments,
            );
        }
      const head = await getCachedHeadRevision(userId, vaultId);
      if (!active()) return;
      headRevision.value = Math.max(headRevision.value, head);
      await refreshPending();
      if (!active()) return;
      cursor = page.next_cursor ?? cursor;
      pullCursor.value = cursor;
      if (!page.next_cursor) {
        syncStatus.value = activeConflict.value
          ? "conflict"
          : pendingNoteIds.value.length
            ? "saving"
            : "synced";
        return;
      }
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
    const seen = new Set<string>();
    for (;;) {
      const path = buildPullOperationsPath(vaultId, { cursor, limit: 100 });
      const response = await syncRequest(path);
      if (!response.ok) {
        throw new Error("Unable to pull conflict variants");
      }
      const page = (await response.json()) as PullResponse;
      if (
        page.protocol_version !== 1 ||
        !Array.isArray(page.operations) ||
        page.operations.some((item) => item.vault_id !== vaultId)
      )
        throw new Error("Invalid sync page");
      if (page.next_cursor && seen.has(page.next_cursor))
        throw new Error("Invalid sync cursor");
      if (page.next_cursor) seen.add(page.next_cursor);
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
    const key = vaultKey;
    const userId = requireUserId();
    const pulled = await pullAllOperations(operation.vault_id);
    if (
      vaultKey !== key ||
      useAuthStore().userId !== userId ||
      currentVaultId.value !== operation.vault_id
    )
      return;
    // Server conflict hashes identify vault-wide revisions, which may concern a different note.
    const variants = pulled.filter(
      (item) =>
        item.note_id === operation.note_id &&
        item.vault_id === operation.vault_id,
    );
    const baseOp = variants
      .filter((item) => item.base_revision + 1 <= conflict.base_revision)
      .at(-1);
    const remoteOp = variants
      .filter((item) => item.base_revision + 1 <= conflict.remote_revision)
      .at(-1);
    const historyThroughRemote = pulled.filter(
      (item) => item.base_revision < conflict.remote_revision,
    );
    const completeHistory =
      historyThroughRemote.length >= conflict.remote_revision &&
      historyThroughRemote.every(
        (item, index) =>
          item.vault_id === operation.vault_id && item.base_revision === index,
      );
    if (
      ((!baseOp && conflict.base_revision > 0) || !remoteOp) &&
      !completeHistory
    )
      throw new Error("Missing conflict ciphertext variants");
    const pending = await listPendingOperations(userId, operation.vault_id);
    if (vaultKey !== key || useAuthStore().userId !== userId) return;
    const latestLocal =
      pending.filter((item) => item.note_id === operation.note_id).at(-1) ??
      operation;
    const local = decryptOperation(latestLocal);
    activeConflict.value = {
      base: baseOp ? decryptOperation(baseOp) : "",
      conflict,
      local,
      manualDraft: local,
      noteId: conflict.note_id,
      remote: remoteOp ? decryptOperation(remoteOp) : "",
    };
    headRevision.value = conflict.remote_revision;
    syncStatus.value = "conflict";
    lastError.value = "Conflit de révision.";
  }

  async function handleConflictResponse(
    operation: EncryptedPushOperation,
    response: Response,
  ): Promise<boolean> {
    const key = vaultKey;
    await blockConflictedOperation(
      requireUserId(),
      operation.operation_id,
      true,
    );
    if (vaultKey !== key) return true;
    let body: Conflict & { code?: string };
    try {
      body = (await response.json()) as Conflict & { code?: string };
    } catch {
      if (vaultKey === key) {
        syncStatus.value = "conflict";
        lastError.value = "Réponse de conflit invalide.";
      }
      return true;
    }
    if (vaultKey !== key) return true;
    if (body.code === "sync_cursor_resnapshot_required") {
      syncStatus.value = "error";
      lastError.value = "Curseur de synchronisation invalide.";
      return true;
    }
    if (
      body.protocol_version !== 1 ||
      body.base_revision !== operation.base_revision ||
      body.operation_id !== operation.operation_id ||
      body.vault_id !== operation.vault_id ||
      body.note_id !== operation.note_id ||
      body.local_ciphertext_hash !== operation.ciphertext_hash ||
      !Number.isSafeInteger(body.remote_revision) ||
      body.remote_revision <= operation.base_revision ||
      !body.base_ciphertext_hash
    ) {
      syncStatus.value = "conflict";
      lastError.value = "Conflit de révision.";
      return true;
    }
    await blockConflictedOperation(
      requireUserId(),
      operation.operation_id,
      body,
    );
    if (vaultKey !== key) return true;
    try {
      await materializeConflict(operation, body);
    } catch {
      if (vaultKey !== key) return true;
      syncStatus.value = "conflict";
      lastError.value = "Conflit de révision (variantes indisponibles).";
    }
    return true;
  }

  async function syncRequest(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    syncControllers.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(new Error("Sync interrupted")),
        { once: true },
      );
      timer = setTimeout(() => controller.abort(), 15000);
    });
    try {
      return await Promise.race([
        fetch(path, {
          credentials: "include",
          ...init,
          signal: controller.signal,
        }).then(
          async (response) =>
            new Response(await response.text(), {
              status: response.status,
              headers: response.headers,
            }),
        ),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
      syncControllers.delete(controller);
    }
  }

  async function pushOperation(
    operation: EncryptedPushOperation,
  ): Promise<Response> {
    return syncRequest(`/v1/vaults/${operation.vault_id}/operations`, {
      body: serializeEncryptedPushOperation(operation),
      headers: csrfHeaders(),
      method: "POST",
    });
  }

  let synchronization: Promise<boolean> | undefined;
  function synchronize(): Promise<boolean> {
    if (synchronization) return synchronization;
    synchronization = (async () => {
      const key = vaultKey;
      const vaultId = currentVaultId.value;
      if (!key || !vaultId || useAuthStore().isLocalMode) return true;
      try {
        await loadNotes(vaultId);
        if (
          vaultKey !== key ||
          syncStatus.value === "offline" ||
          syncStatus.value === "error"
        )
          return false;
        if (!activeConflict.value) await flushPendingOperations();
        return (
          vaultKey === key &&
          !(["offline", "error"] as string[]).includes(syncStatus.value)
        );
      } catch {
        if (vaultKey === key) {
          syncStatus.value = "error";
          lastError.value = "Synchronisation indisponible.";
        }
        return false;
      }
    })().finally(() => {
      synchronization = undefined;
    });
    return synchronization;
  }
  let requestAutomaticSync: (() => void) | undefined;
  function setSyncWakeup(wakeup?: () => void) {
    requestAutomaticSync = wakeup;
  }
  function scheduleDelivery() {
    if (requestAutomaticSync) requestAutomaticSync();
    else void flushPendingOperations();
  }

  let flushInFlight: Promise<void> | undefined;
  function flushPendingOperations(): Promise<void> {
    if (flushInFlight) return flushInFlight;
    flushInFlight = flushQueue().finally(() => {
      flushInFlight = undefined;
    });
    return flushInFlight;
  }

  async function flushQueue(): Promise<void> {
    if (!currentVaultId.value || !vaultKey || useAuthStore().isLocalMode)
      return;
    const userId = requireUserId();
    const vaultId = currentVaultId.value;
    const key = vaultKey;
    const active = () =>
      vaultKey === key &&
      currentVaultId.value === vaultId &&
      useAuthStore().userId === userId;
    const pending = await listPendingOperations(userId, vaultId);
    for (const queued of pending) {
      if (!active()) return;
      try {
        const operation = await prepareOperation(
          userId,
          queued.operation_id,
          (original, revision) => {
            const plaintext = xchacha20poly1305(
              key,
              Uint8Array.from(original.nonce),
              aad(vaultId, original.note_id, original.base_revision),
            ).decrypt(Uint8Array.from(original.ciphertext));
            const nonce = randomNonce();
            const ciphertext = xchacha20poly1305(
              key,
              nonce,
              aad(vaultId, original.note_id, revision),
            ).encrypt(plaintext);
            return {
              ...original,
              base_revision: revision,
              nonce: Array.from(nonce),
              ciphertext: Array.from(ciphertext),
              ciphertext_hash: bytesToHex(sha256(ciphertext)),
            };
          },
        );
        if (!active()) return;
        if (!operation) {
          const conflict = await getOperationConflict(
            userId,
            queued.operation_id,
          );
          if (!active()) return;
          if (conflict) {
            syncStatus.value = "conflict";
            if (conflict !== true && !activeConflict.value) {
              try {
                await materializeConflict(queued, conflict);
              } catch {
                if (active()) {
                  syncStatus.value = "conflict";
                  lastError.value =
                    "Conflit de révision (variantes indisponibles).";
                }
              }
            }
          }
          return;
        }
        const response = await pushOperation(operation);
        if (!active()) return;
        if (response.status === 409) {
          await handleConflictResponse(operation, response);
          return;
        }
        if (!response.ok) {
          syncStatus.value = "error";
          lastError.value = `Enregistrement refusé (${response.status}).`;
          return;
        }
        const ack = (await response.json()) as {
          operation_id?: unknown;
          revision?: unknown;
        };
        if (
          ack.operation_id !== operation.operation_id ||
          typeof ack.revision !== "number" ||
          !Number.isSafeInteger(ack.revision) ||
          ack.revision <= operation.base_revision
        ) {
          syncStatus.value = "error";
          lastError.value = "Accusé de réception invalide.";
          return;
        }
        if (!active()) return;
        await acknowledgeOperation(userId, operation, ack.revision);
        if (!active()) return;
        headRevision.value = Math.max(headRevision.value, ack.revision);
      } catch {
        if (!active()) return;
        syncStatus.value = "offline";
        lastError.value = "Hors ligne.";
        return;
      } finally {
        if (active()) await refreshPending();
      }
    }
    if (active() && (await listPendingOperations(userId, vaultId)).length > 0) {
      await flushQueue();
      return;
    }
    if (active() && pending.length > 0) {
      syncStatus.value = "synced";
      lastError.value = null;
    }
  }

  async function saveNote(input: NoteInput, supersedes: string[] = []) {
    localEditEpoch += 1;
    if (!vaultKey || !currentVaultId.value) {
      lastError.value = "Coffre verrouillé ou absent.";
      syncStatus.value = "error";
      throw new Error("Vault is locked");
    }
    const userId = requireUserId();
    const vaultId = currentVaultId.value;
    const baseRevision = headRevision.value;
    const path = input.path ?? pathForNote(input.id, notes.get(input.id));
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

    const key = vaultKey;
    const historyRevision = await persistPendingOperation(
      userId,
      operation,
      supersedes,
      useAuthStore().isLocalMode,
    );
    if (
      vaultKey !== key ||
      currentVaultId.value !== vaultId ||
      useAuthStore().userId !== userId
    )
      return operation;
    if (!isDeletedNoteContent(input.content)) {
      notes.set(input.id, {
        content: input.content,
        path,
        revision: baseRevision,
      });
    }

    pendingNoteIds.value = [...new Set([...pendingNoteIds.value, input.id])];
    await rememberHistory(userId, operation, input.content, historyRevision);
    if (useAuthStore().isLocalMode) {
      pendingNoteIds.value = [];
      syncStatus.value = "synced";
    } else scheduleDelivery();

    return operation;
  }

  async function pushPlaintext(noteId: string, plaintext: Uint8Array) {
    localEditEpoch += 1;
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
    const key = vaultKey;
    await persistPendingOperation(
      userId,
      operation,
      [],
      useAuthStore().isLocalMode,
    );
    if (
      vaultKey !== key ||
      currentVaultId.value !== vaultId ||
      useAuthStore().userId !== userId
    )
      return { operation, revision: baseRevision };
    pendingNoteIds.value = [...new Set([...pendingNoteIds.value, noteId])];
    if (useAuthStore().isLocalMode) {
      pendingNoteIds.value = [];
      syncStatus.value = "synced";
    } else scheduleDelivery();
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
    const key = vaultKey;
    const result = await pushPlaintext(id, plaintext);
    if (vaultKey !== key) return result.operation;
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
    const key = vaultKey;
    const vaultId = currentVaultId.value;
    const userId = useAuthStore().userId;
    await loadHistory(id);
    if (
      !key ||
      vaultKey !== key ||
      currentVaultId.value !== vaultId ||
      useAuthStore().userId !== userId
    )
      throw new Error("Vault is locked");
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
    const key = vaultKey;
    const result = await saveNote({ content: DELETED_NOTE_SENTINEL, id });
    if (vaultKey === key) {
      notes.delete(id);
      attachments.delete(id);
    }
    return result;
  }

  async function resolveConflict(content: string) {
    const current = activeConflict.value;
    if (!current || !vaultKey || !currentVaultId.value) {
      throw new Error("No active conflict");
    }
    const expected = current.conflict;
    const baseRevision = expected.remote_revision;
    headRevision.value = baseRevision;
    const key = vaultKey;
    const pending = await listPendingOperations(
      requireUserId(),
      currentVaultId.value,
    );
    if (vaultKey !== key || activeConflict.value !== current)
      throw new Error("Vault is locked");
    const result = await saveNote(
      { content, id: current.noteId },
      pending
        .filter((operation) => operation.note_id === current.noteId)
        .map((operation) => operation.operation_id),
    );
    if (vaultKey === key && activeConflict.value === current)
      activeConflict.value = null;
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
    synchronize,
    setSyncWakeup,
    activeConflict,
    allowTrustedUnlock,
    changePassphrase,
    clearDeviceData,
    createAndUnlockVault,
    createRestorePoint,
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
    loadHistory,
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
    rememberRecentNote,
    renameNote,
    resolveConflict,
    restoreRevision,
    restorePointsFor,
    saveAttachment,
    savePreferences,
    saveNote,
    searchNotes,
    setHasEncryptedVault,
    setSyncStatus,
    shouldSkipTrustedUnlock,
    syncStatus,
    tryUnlockFromTrustedDevice,
    togglePinnedNote,
    unlock,
    unlockWithTrustedDevice,
  };
});
