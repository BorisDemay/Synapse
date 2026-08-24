<script setup lang="ts">
import {
  AiChat,
  AiConversationPanel,
  AppShell,
  BacklinksPanel,
  ConflictResolver,
  GraphPanel,
  NoteRelationsPanel,
  MarkdownEditor,
  SearchPalette,
  SettingsPanel,
  ThemeToggle,
  VaultTree,
  backlinksFor,
  buildLocalGraph,
  buildVaultTree,
  parseNote,
  resolveWikilink,
  sanitizeAttachmentFileName,
  searchLocalNotes,
  uniqueTags,
  useTheme,
  wikilinkPath,
  type PaletteCommand,
  type SettingsSession,
  type VaultTreeNode,
} from "@synapse/ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import Button from "primevue/button";

import { useAssistantStore } from "../stores/assistant";
import { useAuthStore } from "../stores/auth";
import { useVaultStore } from "../stores/vault";

const vault = useVaultStore();
const auth = useAuthStore();
const assistant = useAssistantStore();
const router = useRouter();
const content = ref("# Nouvelle note\n\n");
const noteId = ref("nouvelle.md");
const selectedNoteId = ref<string | null>(null);
const formError = ref("");
const assistantOpen = ref(false);
const assistantHistoryOpen = ref(true);
const noteHistoryOpen = ref(true);
const graphOpen = ref(false);
const settingsOpen = ref(false);
const searchQuery = ref("");
const tagFilter = ref("");
const blobUrls = ref<Record<string, string>>({});
const theme = useTheme();
const settingsError = ref("");
const settingsStatus = ref("");
const accountEmail = ref("");
const sessions = ref<SettingsSession[]>([]);
let pendingSave:
  | {
      content: string;
      noteId: string;
    }
  | undefined;
let saveInFlight: Promise<void> | undefined;

function noteTitle(markdown: string, fallback: string): string {
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

const queryNotes = computed(() =>
  Array.from(vault.notes.entries()).map(([id, note]) => ({
    content: note.content,
    id,
    label: noteTitle(note.content, id),
    path: id,
  })),
);

const treeNodes = computed<VaultTreeNode[]>(() => {
  const sources = queryNotes.value
    .filter((note) => {
      if (!tagFilter.value) {
        return true;
      }
      return parseNote(note.content).tags.includes(tagFilter.value);
    })
    .map((note) => ({
      id: note.id,
      kind: "note" as const,
      label: note.label,
      path: note.path,
      syncStatus: vault.noteSyncStatus(note.id),
      tags: parseNote(note.content).tags,
    }));
  const attached = vault.attachments.map((file) => ({
    id: file.id,
    kind: "attachment" as const,
    label: file.label,
    path: file.id,
    syncStatus: vault.noteSyncStatus(file.id),
  }));
  return buildVaultTree([...sources, ...attached]);
});

const searchResults = computed(() =>
  searchLocalNotes(queryNotes.value, searchQuery.value),
);

const paletteCommands = computed<PaletteCommand[]>(() => [
  { id: "new-note", label: "Nouvelle note" },
  { id: "new-folder", label: "Nouveau dossier" },
  { id: "lock", label: "Verrouiller le coffre" },
  { id: "settings", label: "Paramètres" },
  { id: "theme", label: "Basculer le thème" },
  { id: "graph", label: "Afficher le graphe local" },
]);

const allTags = computed(() => uniqueTags(queryNotes.value));

const currentQueryNote = computed(() =>
  queryNotes.value.find((note) => note.id === noteId.value),
);

const currentBacklinks = computed(() => {
  const current = currentQueryNote.value;
  return current ? backlinksFor(queryNotes.value, current) : [];
});

const localGraph = computed(() => buildLocalGraph(queryNotes.value));

const historyEntries = computed(() => vault.history);

function selectNote(id: string) {
  if (id.startsWith("attachments/")) {
    void openAttachment(id);
    return;
  }
  selectedNoteId.value = id;
  noteId.value = id;
  content.value = vault.notes.get(id)?.content ?? "";
  formError.value = "";
  void vault.readNote(id).then((next) => {
    if (selectedNoteId.value === id) {
      content.value = next;
    }
  });
  void vault.loadBacklinks(id);
  void vault.loadHistory(id);
}

function attachNote(id: string) {
  assistant.attachNote(id);
  assistantOpen.value = true;
}

async function connectAssistant(token: string) {
  formError.value = "";
  try {
    await assistant.connect(token);
  } catch (error) {
    formError.value =
      error instanceof Error ? error.message : "Connexion Codex impossible.";
  }
}

async function connectChatgpt() {
  formError.value = "";
  try {
    await assistant.connectWithChatgpt();
  } catch {
    // The store already exposes a safe, redacted error.
  }
}

async function sendAssistant(prompt: string) {
  try {
    showNote(await assistant.send(prompt));
  } catch {
    // The store already exposes a safe, redacted error.
  }
}

function showNote(id: string) {
  selectedNoteId.value = id;
  noteId.value = id;
  content.value = vault.notes.get(id)?.content ?? "";
}

function startNewNote(folder?: string) {
  const draft = "# Nouvelle note\n\n";
  noteId.value = vault.nextNotePath(draft, [noteId.value], folder);
  selectedNoteId.value = null;
  content.value = draft;
  formError.value = "";
}

async function deleteNote(id: string) {
  if (pendingSave?.noteId === id) {
    pendingSave = undefined;
  }
  formError.value = "";
  try {
    await vault.deleteNote(id);
    assistant.detachNote(id);
    if (selectedNoteId.value === id || noteId.value === id) {
      startNewNote();
    }
  } catch (error) {
    formError.value =
      error instanceof Error ? error.message : "Suppression impossible.";
  }
}

async function save(nextContent = content.value) {
  content.value = nextContent;
  pendingSave = { content: nextContent, noteId: noteId.value };
  if (saveInFlight) {
    return saveInFlight;
  }

  saveInFlight = (async () => {
    while (pendingSave) {
      const currentSave = pendingSave;
      pendingSave = undefined;
      formError.value = "";
      try {
        await vault.saveNote({
          content: currentSave.content,
          id: currentSave.noteId,
        });
        if (noteId.value === currentSave.noteId) {
          selectedNoteId.value = currentSave.noteId;
        }
        if (vault.syncStatus === "error" || vault.syncStatus === "conflict") {
          formError.value = vault.lastError ?? "Enregistrement impossible.";
        }
      } catch (error) {
        formError.value =
          error instanceof Error ? error.message : "Enregistrement impossible.";
      }
    }
  })().finally(() => {
    saveInFlight = undefined;
  });

  return saveInFlight;
}

async function onOnline() {
  await vault.flushPendingOperations();
}

async function resolveWith(contentChoice: string) {
  formError.value = "";
  const conflictNoteId = vault.activeConflict?.noteId;
  try {
    await vault.resolveConflict(contentChoice);
    content.value = contentChoice;
    if (conflictNoteId) {
      noteId.value = conflictNoteId;
      selectedNoteId.value = conflictNoteId;
    }
  } catch (error) {
    formError.value =
      error instanceof Error ? error.message : "Résolution impossible.";
  }
}

async function logout() {
  try {
    if (auth.isAuthenticated) {
      await auth.logout();
    }
  } finally {
    await router.replace("/login");
  }
}

function goOnline() {
  if (auth.isAuthenticated) {
    void router.push("/unlock");
    return;
  }
  void router.push("/login");
}

async function lockVault() {
  settingsOpen.value = false;
  await vault.lock();
}

async function loadAccountSettings() {
  settingsError.value = "";
  if (!auth.isAuthenticated) {
    return;
  }
  try {
    const listed = await auth.listSessions();
    accountEmail.value = listed.email;
    sessions.value = listed.sessions;
  } catch {
    settingsError.value = "Impossible de charger les sessions.";
  }
}

async function changePassword(current: string, next: string) {
  settingsError.value = "";
  settingsStatus.value = "";
  try {
    await auth.changePassword(current, next);
    settingsStatus.value =
      "Mot de passe mis à jour. Les autres sessions ont été révoquées.";
    await loadAccountSettings();
  } catch {
    settingsError.value = "Impossible de changer le mot de passe.";
  }
}

async function changePassphrase(current: string, next: string) {
  settingsError.value = "";
  settingsStatus.value = "";
  try {
    await vault.changePassphrase(current, next);
    settingsStatus.value = "Phrase de déchiffrement mise à jour.";
  } catch {
    settingsError.value =
      "Impossible de changer la phrase. Vérifiez la phrase actuelle.";
  }
}

async function exportNotes() {
  settingsStatus.value = "Les notes sont déjà des fichiers Markdown locaux.";
}

async function revokeSession(id: string) {
  settingsError.value = "";
  try {
    await auth.revokeSession(id);
    await loadAccountSettings();
  } catch {
    settingsError.value = "Impossible de révoquer la session.";
  }
}

async function revokeOtherSessions() {
  settingsError.value = "";
  try {
    await auth.revokeOtherSessions();
    settingsStatus.value = "Les autres sessions ont été révoquées.";
    await loadAccountSettings();
  } catch {
    settingsError.value = "Impossible de révoquer les sessions.";
  }
}

async function deleteAccount(password: string) {
  settingsError.value = "";
  try {
    await auth.deleteAccount(password);
    settingsOpen.value = false;
    await router.push("/login");
  } catch {
    settingsError.value =
      "Suppression impossible. Vérifiez le mot de passe du compte.";
  }
}

function runCommand(id: string) {
  if (id === "new-note") {
    startNewNote();
  } else if (id === "new-folder") {
    const name = window.prompt("Nom du dossier");
    if (name?.trim()) {
      startNewNote(name.trim().replaceAll("..", ""));
    }
  } else if (id === "lock") {
    void lockVault();
  } else if (id === "settings") {
    settingsOpen.value = true;
  } else if (id === "theme") {
    theme.toggleTheme();
  } else if (id === "graph") {
    graphOpen.value = true;
  }
}

async function openWikilink(target: string) {
  const existing = resolveWikilink(queryNotes.value, target);
  if (existing) {
    selectNote(existing.id);
    return;
  }
  const path = wikilinkPath(target, noteId.value);
  const markdown = `# ${target}\n\n`;
  await vault.saveNote({ content: markdown, id: path });
  selectNote(path);
}

async function attachFiles(files: File[]) {
  for (const file of files) {
    const name = sanitizeAttachmentFileName(file.name);
    const path = `attachments/${name}`;
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    try {
      await vault.saveAttachment(path, bytes);
    } catch (error) {
      formError.value =
        error instanceof Error ? error.message : "Pièce jointe refusée.";
      continue;
    }
    const snippet = file.type.startsWith("image/")
      ? `![${name}](${path})`
      : `[${name}](${path})`;
    content.value = `${content.value.trimEnd()}\n\n${snippet}\n`;
    await save(content.value);
    await refreshBlobUrl(path);
  }
}

async function refreshBlobUrl(path: string) {
  try {
    const bytes = await vault.readAttachment(path);
    const previous = blobUrls.value[path];
    if (previous) {
      URL.revokeObjectURL(previous);
    }
    const type = path.endsWith(".png")
      ? "image/png"
      : path.endsWith(".pdf")
        ? "application/pdf"
        : "application/octet-stream";
    blobUrls.value = {
      ...blobUrls.value,
      [path]: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type })),
    };
  } catch {
    // Preview is optional; the markdown path still persists.
  }
}

async function openAttachment(path: string) {
  await refreshBlobUrl(path);
  const url = blobUrls.value[path];
  if (!url) {
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = path.split("/").pop() ?? "fichier";
  link.click();
}

async function restoreHistory(revision: number) {
  try {
    content.value = await vault.restoreRevision(noteId.value, revision);
  } catch (error) {
    formError.value =
      error instanceof Error ? error.message : "Restauration impossible.";
  }
}

onMounted(() => {
  if (!vault.vaultName) {
    void router.replace("/");
    return;
  }
  window.addEventListener("online", onOnline);
  if (navigator.onLine) {
    void vault.flushPendingOperations();
  }
  if (vault.isUnlocked) {
    void assistant.restore();
  }
});

onUnmounted(() => {
  window.removeEventListener("online", onOnline);
  for (const url of Object.values(blobUrls.value)) {
    URL.revokeObjectURL(url);
  }
});

watch(
  () => vault.isUnlocked,
  (unlocked) => {
    if (unlocked) {
      void assistant.restore();
      return;
    }
    assistant.lockSession();
  },
);

watch(settingsOpen, (open) => {
  if (!open) {
    return;
  }
  settingsStatus.value = "";
  settingsError.value = "";
  void loadAccountSettings();
});
</script>

<template>
  <AppShell class="vault-page">
    <template #navigation>
      <header class="vault-nav-header">
        <div class="vault-brand-row">
          <div class="brand-mark">
            <span class="brand-symbol" aria-hidden="true">S</span>
            <span>Synapse</span>
          </div>
          <ThemeToggle />
        </div>
        <div class="vault-heading">
          <div>
            <span class="eyebrow">ESPACE PRIVÉ</span>
            <h1>{{ vault.vaultName || "Coffre local" }}</h1>
          </div>
          <span class="sync-pill" :data-status="vault.syncStatus" role="status">
            <span class="sync-dot" aria-hidden="true" />
            {{ vault.syncStatus }}
          </span>
        </div>
        <Button
          icon="pi pi-folder-open"
          label="Ouvrir un coffre"
          outlined
          type="button"
          aria-label="Ouvrir un coffre"
          @click="vault.openVault()"
        />
        <Button
          v-if="!vault.isUnlocked"
          class="online-vault-button"
          icon="pi pi-cloud"
          :label="
            auth.isAuthenticated
              ? 'Activer la sync'
              : 'Se connecter à une vault distante'
          "
          outlined
          type="button"
          aria-label="Conserver les notes en ligne"
          @click="goOnline"
        />
        <Button
          class="new-note-button"
          icon="pi pi-plus"
          label="Nouvelle note"
          outlined
          type="button"
          @click="startNewNote()"
        />
      </header>
      <div v-if="allTags.length" class="tag-filter" aria-label="Tags">
        <button
          v-for="tag in allTags"
          :key="tag"
          type="button"
          :data-active="tagFilter === tag ? 'true' : undefined"
          @click="tagFilter = tagFilter === tag ? '' : tag"
        >
          #{{ tag }}
        </button>
      </div>
      <div class="sidebar-section-label">NOTES</div>
      <VaultTree
        :attached-ids="assistant.attachedNoteIds"
        :nodes="treeNodes"
        @attach="attachNote"
        @delete="deleteNote"
        @select="selectNote"
      />
      <div class="sidebar-footer">
        <button
          class="settings-button"
          type="button"
          aria-haspopup="dialog"
          aria-label="Ouvrir les paramètres"
          @click="settingsOpen = true"
        >
          <span class="settings-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path
                fill="currentColor"
                d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.6.24-1.15.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64L4.86 10.7c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.16a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.64.22l2.39-.96c.48.39 1.03.7 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.6-.24 1.15-.55 1.63-.94l2.39.96c.24.1.51.01.64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
              />
            </svg>
          </span>
          Paramètres
        </button>
        <button class="logout-button" type="button" @click="logout">
          <span aria-hidden="true">↪</span>
          {{ auth.isAuthenticated ? "Se déconnecter" : "Compte" }}
        </button>
      </div>
    </template>

    <section class="vault-workspace" aria-label="Édition de note">
      <header class="workspace-header">
        <div>
          <span class="eyebrow">ÉDITION MARKDOWN</span>
        </div>
        <div class="workspace-meta">
          <span v-if="vault.isUnlocked" class="online-label"
            >Conservé en ligne</span
          >
          <span v-else-if="!auth.isAuthenticated" class="offline-label"
            >Hors ligne</span
          >
          <span class="save-hint">Sauvegarde automatique</span>
          <Button
            v-if="!assistantOpen"
            label="Codex"
            outlined
            type="button"
            @click="assistantOpen = true"
          />
          <Button
            label="Graphe"
            outlined
            type="button"
            @click="graphOpen = !graphOpen"
          />
        </div>
      </header>
      <ConflictResolver
        v-if="vault.activeConflict"
        :base="vault.activeConflict.base"
        :local="vault.activeConflict.local"
        :remote="vault.activeConflict.remote"
        :manual-draft="vault.activeConflict.manualDraft"
        @update:manual-draft="vault.activeConflict.manualDraft = $event"
        @keep-local="resolveWith(vault.activeConflict.local)"
        @keep-remote="resolveWith(vault.activeConflict.remote)"
        @edit-manual="resolveWith(vault.activeConflict.manualDraft)"
      />
      <template v-else>
        <div class="editor-surface">
          <MarkdownEditor
            v-model="content"
            :attachment-urls="blobUrls"
            @attach-files="attachFiles"
            @open-wikilink="openWikilink"
            @save="save"
          />
        </div>
      </template>
      <p
        v-if="formError || vault.lastError"
        class="workspace-error"
        role="alert"
      >
        {{ formError || vault.lastError }}
      </p>
    </section>
    <template #relations v-if="graphOpen || (assistantOpen && noteHistoryOpen)">
      <GraphPanel
        v-if="graphOpen"
        :graph="localGraph"
        :selected-id="noteId"
        @close="graphOpen = false"
        @select="selectNote"
      />
      <NoteRelationsPanel
        v-else
        :backlinks="currentBacklinks"
        :history="historyEntries"
        @close="noteHistoryOpen = false"
        @restore="restoreHistory"
        @select="selectNote"
      />
    </template>
    <template #assistantHistory v-if="assistantOpen && assistantHistoryOpen">
      <AiConversationPanel
        :active-conversation-id="assistant.activeConversationId"
        :busy="assistant.busy"
        :conversations="assistant.conversationSummaries"
        @close="assistantHistoryOpen = false"
        @new-conversation="assistant.newConversation"
        @open-conversation="assistant.openConversation"
      />
    </template>
    <template #assistant v-if="assistantOpen">
      <AiChat
        :attachments="assistant.attachments"
        :busy="assistant.busy"
        :connected="assistant.connected"
        :conversations-panel-open="assistantHistoryOpen"
        :device-login="assistant.deviceLogin"
        :error="assistant.error"
        :fast="assistant.fast"
        :fast-available="Boolean(assistant.fastTier)"
        :fast-label="assistant.fastTier?.name ?? assistant.fastTier?.id"
        :history-panel-open="noteHistoryOpen"
        :messages="assistant.messages"
        :model="assistant.model"
        :models="assistant.models"
        :reasoning-effort="assistant.reasoningEffort"
        :reasoning-levels="assistant.reasoningLevels"
        @cancel-chatgpt="assistant.cancelChatgptLogin"
        @connect="connectAssistant"
        @connect-chatgpt="connectChatgpt"
        @close-panel="assistantOpen = false"
        @detach="assistant.detachNote"
        @disconnect="assistant.disconnect"
        @send="sendAssistant"
        @toggle-conversations="assistantHistoryOpen = !assistantHistoryOpen"
        @toggle-history="noteHistoryOpen = !noteHistoryOpen"
        @update:fast="assistant.setFast"
        @update:model="assistant.setModel"
        @update:reasoning-effort="assistant.setReasoningEffort"
      />
    </template>
  </AppShell>
  <SettingsPanel
    :account-email="accountEmail"
    :device-supported="false"
    :device-trusted="false"
    :error-message="settingsError"
    :export-supported="false"
    :offline="!auth.isAuthenticated"
    :open="settingsOpen"
    :sessions="sessions"
    :status-message="settingsStatus"
    @change-passphrase="changePassphrase"
    @change-password="changePassword"
    @close="settingsOpen = false"
    @delete-account="deleteAccount"
    @export-notes="exportNotes"
    @lock-vault="lockVault"
    @revoke-other-sessions="revokeOtherSessions"
    @revoke-session="revokeSession"
  />
  <SearchPalette
    :commands="paletteCommands"
    :query="searchQuery"
    :results="searchResults"
    @run="runCommand"
    @select="selectNote"
    @update:query="searchQuery = $event"
  />
</template>

<style scoped>
.vault-page {
  height: 100%;
  min-height: 0;
}

.vault-page :deep(.app-shell) {
  height: 100%;
  min-height: 100%;
}

.vault-page > :deep(.app-shell-sidebar) {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.35rem 1rem;
  background: color-mix(
    in srgb,
    var(--synapse-color-surface-raised) 65%,
    var(--synapse-color-surface)
  );
  backdrop-filter: blur(6px);
}

.vault-page > :deep(.app-shell-content) {
  padding: 0;
}

.vault-page > :deep(.app-shell-assistant) {
  padding: 1.25rem 1rem;
}

.vault-nav-header {
  display: grid;
  gap: 1.2rem;
}

.vault-brand-row,
.vault-heading,
.workspace-header,
.workspace-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 1.05rem;
  font-weight: 750;
  letter-spacing: -0.02em;
}

.brand-symbol {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--synapse-radius-md);
  color: var(--synapse-color-accent-contrast);
  background: linear-gradient(
    135deg,
    var(--synapse-color-accent),
    var(--synapse-color-accent-strong)
  );
  font-size: 0.95rem;
  box-shadow: var(--synapse-shadow-sm);
}

.vault-heading h1,
.workspace-header h2 {
  margin: 0.2rem 0 0;
  letter-spacing: -0.04em;
}

.vault-heading h1 {
  font-size: 1.4rem;
}

.workspace-header h2 {
  font-size: clamp(1.4rem, 2.5vw, 2rem);
}

.eyebrow,
.sidebar-section-label {
  color: var(--synapse-color-text-muted);
  font-size: 0.66rem;
  font-weight: 750;
  letter-spacing: 0.14em;
}

.sync-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  color: var(--synapse-color-success);
  background: color-mix(in srgb, var(--synapse-color-success) 12%, transparent);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: capitalize;
}

.sync-pill[data-status="offline"] {
  color: var(--synapse-color-warning);
  background: color-mix(in srgb, var(--synapse-color-warning) 12%, transparent);
}

.sync-pill[data-status="conflict"],
.sync-pill[data-status="error"] {
  color: var(--synapse-color-danger);
  background: color-mix(in srgb, var(--synapse-color-danger) 12%, transparent);
}

.sync-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 22%, transparent);
}

.new-note-button {
  width: 100%;
}

.tag-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.tag-filter button {
  padding: 0.2rem 0.55rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: 999px;
  color: var(--synapse-color-text-muted);
  background: transparent;
  cursor: pointer;
}

.tag-filter button[data-active="true"] {
  color: var(--synapse-color-accent-strong);
  background: var(--synapse-color-surface-accent);
}

.sidebar-section-label {
  padding-inline: 0.7rem;
}

.sidebar-footer {
  display: grid;
  gap: 0.25rem;
  margin-top: auto;
  padding-top: 1rem;
  border-top: 1px solid var(--synapse-color-border);
}

.settings-button,
.logout-button {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.65rem 0.7rem;
  border: 0;
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: transparent;
  cursor: pointer;
  text-align: start;
  transition:
    color 140ms ease,
    background 140ms ease;
}

.settings-icon {
  display: grid;
  place-items: center;
  width: 1.15rem;
  height: 1.15rem;
}

.settings-button:hover {
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-muted);
}

.logout-button:hover {
  color: var(--synapse-color-danger);
  background: color-mix(
    in srgb,
    var(--synapse-color-danger) 8%,
    var(--synapse-color-surface-muted)
  );
}

.vault-workspace {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 0;
  min-width: 0;
  height: 100%;
  padding: 0;
}

.workspace-header {
  padding: 1.25rem clamp(1rem, 3vw, 2rem) 1rem;
  border-bottom: 1px solid var(--synapse-color-border);
  background: color-mix(
    in srgb,
    var(--synapse-color-surface-raised) 55%,
    var(--synapse-color-surface)
  );
  backdrop-filter: blur(4px);
}

.editor-surface {
  min-width: 0;
  min-height: 24rem;
  overflow: auto;
  background: var(--synapse-color-surface);
}

.editor-surface :deep(.markdown-editor) {
  height: 100%;
  min-width: 0;
  min-height: 24rem;
}

.editor-surface :deep(.vditor) {
  min-width: 0;
  min-height: 100%;
}

.workspace-meta {
  color: var(--synapse-color-text-muted);
  font-size: 0.8rem;
}

.save-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.save-hint::before {
  content: "";
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--synapse-color-success);
}

.offline-label,
.online-label {
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-weight: 700;
}

.offline-label {
  color: var(--synapse-color-warning);
  background: color-mix(in srgb, var(--synapse-color-warning) 12%, transparent);
}

.online-label {
  color: var(--synapse-color-success);
  background: color-mix(in srgb, var(--synapse-color-success) 12%, transparent);
}

.workspace-error {
  margin: 0;
  padding: 0.8rem 1rem;
  border: 1px solid
    color-mix(
      in srgb,
      var(--synapse-color-danger) 30%,
      var(--synapse-color-border)
    );
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-danger);
  background: color-mix(in srgb, var(--synapse-color-danger) 9%, transparent);
}

@media (max-width: 860px) {
  .vault-page > :deep(.app-shell-sidebar) {
    max-height: 22rem;
  }

  .vault-workspace {
    height: auto;
    min-height: 70vh;
  }

  .workspace-header {
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .workspace-meta {
    flex-wrap: wrap;
  }
}
</style>
