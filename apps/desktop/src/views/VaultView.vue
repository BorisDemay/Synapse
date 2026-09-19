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
  VaultExplorerToolbar,
  VaultNotesSectionHeader,
  IconActionButton,
  VaultTree,
  useSidebarLayout,
  defaultAssistantSidePanelsOpen,
  useCompactAssistantLayout,
  backlinksFor,
  buildLocalGraph,
  buildVaultTree,
  isNewNoteDraft,
  noteUpdatedAt,
  parseNote,
  renderTemplate,
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

import { ASSISTANT_PROVIDERS } from "../ai/providers";
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
const assistantDefaults = defaultAssistantSidePanelsOpen();
const assistantOpen = ref(false);
const assistantHistoryOpen = ref(assistantDefaults.history);
const noteHistoryOpen = ref(assistantDefaults.relations);
const compactAssistant = useCompactAssistantLayout();
compactAssistant.bindSidePanels({
  historyOpen: assistantHistoryOpen,
  relationsOpen: noteHistoryOpen,
});
const graphOpen = ref(false);
const settingsOpen = ref(false);
const searchQuery = ref("");
const tagFilter = ref("");
const blobUrls = ref<Record<string, string>>({});
const attachmentPreview = ref<{
  contentType: string;
  name: string;
  url: string;
} | null>(null);
const theme = useTheme();
const sidebar = useSidebarLayout();
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

const wikilinkSuggestions = computed(() =>
  queryNotes.value
    .filter((note) => note.id !== noteId.value)
    .map(({ label, path }) => ({ label, path })),
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
      updatedAt: noteUpdatedAt(note.id, note.content),
    }));
  const attached = vault.attachments.map((file) => ({
    id: file.id,
    kind: "attachment" as const,
    label: file.label,
    path: file.id,
    syncStatus: vault.noteSyncStatus(file.id),
    updatedAt: noteUpdatedAt(file.id, ""),
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
  { id: "from-template", label: "Créer une note depuis un modèle" },
  { id: "toggle-sidebar", label: "Afficher ou masquer la barre latérale" },
  { id: "toggle-compact", label: "Afficher ou masquer les titres de section" },
]);

const allTags = computed(() => uniqueTags(queryNotes.value));

const currentQueryNote = computed(() =>
  queryNotes.value.find((note) => note.id === noteId.value),
);

const currentBacklinks = computed(() => {
  const current = currentQueryNote.value;
  return current ? backlinksFor(queryNotes.value, current) : [];
});

const templateNotes = computed(() =>
  queryNotes.value.filter((note) => note.path.startsWith("Templates/")),
);

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

const assistantProviders = ASSISTANT_PROVIDERS.map((provider) => ({
  deviceLogin: provider.deviceLogin === true,
  id: provider.id,
  label: provider.label,
  needsBaseUrl: provider.needsBaseUrl === true,
}));

async function connectAssistant(credentials: {
  baseUrl?: string;
  provider: string;
  token: string;
}) {
  formError.value = "";
  try {
    await assistant.connect(credentials.token, {
      baseUrl: credentials.baseUrl,
      provider: credentials.provider,
    });
  } catch (error) {
    formError.value =
      error instanceof Error
        ? error.message
        : "Connexion à l’assistant impossible.";
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

async function startFromTemplate() {
  if (!templateNotes.value.length) {
    formError.value = "Ajoutez un modèle Markdown sous Templates/ d’abord.";
    return;
  }
  const choices = templateNotes.value
    .map((note, index) => `${index + 1}. ${note.label}`)
    .join("\n");
  const index =
    Number(window.prompt(`Choisir un modèle :\n${choices}`, "1")) - 1;
  const template = templateNotes.value[index];
  if (!template) return;
  const title =
    window.prompt("Titre de la note", template.label) || template.label;
  const path = `${title.replaceAll("/", "-").trim() || "nouvelle"}.md`;
  await vault.saveNote({
    content: renderTemplate(template.content, { date: new Date(), title }),
    id: path,
  });
  selectNote(path);
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
  if (!vault.notes.has(noteId.value) && isNewNoteDraft(nextContent)) {
    return;
  }
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
  } else if (id === "from-template") {
    void startFromTemplate();
  } else if (id === "toggle-sidebar") {
    sidebar.toggleCollapsed();
  } else if (id === "toggle-compact") {
    sidebar.toggleCompact();
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
    const type = contentTypeForAttachment(path);
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
  const contentType = contentTypeForAttachment(path);
  const name = path.split("/").pop() ?? "fichier";
  if (isSafePreviewType(contentType)) {
    attachmentPreview.value = { contentType, name, url };
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
}

function contentTypeForAttachment(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return (
    {
      gif: "image/gif",
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      mp3: "audio/mpeg",
      ogg: "audio/ogg",
      pdf: "application/pdf",
      png: "image/png",
      wav: "audio/wav",
      webm: "video/webm",
      webp: "image/webp",
      mp4: "video/mp4",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}

function isSafePreviewType(contentType: string): boolean {
  return contentType !== "application/octet-stream";
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
  <AppShell
    class="vault-page"
    :class="{ 'vault-page--compact': sidebar.compact.value }"
    :sidebar-collapsed="sidebar.collapsed.value"
  >
    <template #navigation>
      <header class="vault-nav-header">
        <div v-if="!sidebar.collapsed.value" class="vault-brand-row">
          <div class="brand-mark">
            <span class="brand-symbol" aria-hidden="true">S</span>
            <span class="brand-name">Synapse</span>
          </div>
          <ThemeToggle />
        </div>
        <div
          v-if="!sidebar.collapsed.value && !sidebar.compact.value"
          class="vault-heading"
        >
          <div>
            <span class="eyebrow">ESPACE PRIVÉ</span>
            <h1>{{ vault.vaultName || "Coffre local" }}</h1>
          </div>
          <span class="sync-pill" :data-status="vault.syncStatus" role="status">
            <span class="sync-dot" aria-hidden="true" />
            {{ vault.syncStatus }}
          </span>
        </div>
        <div class="vault-toolbar-row">
          <IconActionButton label="Ouvrir un coffre" @click="vault.openVault()">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z"
              />
            </svg>
          </IconActionButton>
          <IconActionButton
            v-if="!vault.isUnlocked"
            :label="
              auth.isAuthenticated
                ? 'Activer la sync'
                : 'Se connecter à une vault distante'
            "
            @click="goOnline"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96Z"
              />
            </svg>
          </IconActionButton>
          <VaultExplorerToolbar
            show-template
            :compact="sidebar.compact.value"
            :sidebar-collapsed="sidebar.collapsed.value"
            @from-template="startFromTemplate"
            @toggle-compact="sidebar.toggleCompact()"
            @toggle-sidebar="sidebar.toggleCollapsed()"
          />
        </div>
      </header>
      <div
        v-if="!sidebar.collapsed.value && allTags.length"
        class="tag-filter"
        aria-label="Tags"
      >
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
      <VaultNotesSectionHeader
        :compact="sidebar.compact.value"
        :collapsed="sidebar.collapsed.value"
        @new-note="startNewNote()"
      />
      <VaultTree
        v-if="!sidebar.collapsed.value"
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
          :aria-expanded="settingsOpen"
          aria-label="Ouvrir les paramètres"
          title="Paramètres"
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
          <span class="settings-label">Paramètres</span>
        </button>
        <button
          class="logout-button"
          type="button"
          :aria-label="auth.isAuthenticated ? 'Se déconnecter' : 'Compte'"
          :title="auth.isAuthenticated ? 'Se déconnecter' : 'Compte'"
          @click="logout"
        >
          <span aria-hidden="true">↪</span>
          <span class="logout-label">{{
            auth.isAuthenticated ? "Se déconnecter" : "Compte"
          }}</span>
        </button>
      </div>
    </template>

    <section class="vault-workspace" aria-label="Édition de note">
      <header class="workspace-header">
        <div>
          <span v-if="!sidebar.compact.value" class="eyebrow"
            >ÉDITION MARKDOWN</span
          >
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
            label="Assistant"
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
            :wikilink-suggestions="wikilinkSuggestions"
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
        :providers="assistantProviders"
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
  <div
    v-if="attachmentPreview"
    class="attachment-preview-backdrop"
    role="presentation"
    @click.self="attachmentPreview = null"
  >
    <section
      :aria-label="`Aperçu ${attachmentPreview.name}`"
      aria-modal="true"
      class="attachment-preview"
      role="dialog"
    >
      <header>
        <strong>{{ attachmentPreview.name }}</strong>
        <button
          type="button"
          aria-label="Fermer l’aperçu"
          @click="attachmentPreview = null"
        >
          ×
        </button>
      </header>
      <img
        v-if="attachmentPreview.contentType.startsWith('image/')"
        :src="attachmentPreview.url"
        :alt="attachmentPreview.name"
      />
      <audio
        v-else-if="attachmentPreview.contentType.startsWith('audio/')"
        controls
        :src="attachmentPreview.url"
      />
      <video
        v-else-if="attachmentPreview.contentType.startsWith('video/')"
        controls
        :src="attachmentPreview.url"
      />
      <iframe
        v-else
        title="Aperçu PDF"
        :src="attachmentPreview.url"
        sandbox="allow-same-origin"
      />
    </section>
  </div>
</template>

<style scoped>
.vault-page {
  height: 100%;
  min-height: 0;
}

.attachment-preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(15 23 42 / 55%);
}
.attachment-preview {
  display: grid;
  gap: 0.75rem;
  width: min(64rem, 100%);
  max-height: calc(100vh - 2rem);
  padding: 1rem;
  overflow: auto;
  border-radius: var(--synapse-radius-md);
  background: var(--synapse-color-surface-raised);
}
.attachment-preview header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.attachment-preview header button {
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: transparent;
  cursor: pointer;
}
.attachment-preview img,
.attachment-preview video,
.attachment-preview iframe {
  width: 100%;
  max-height: 72vh;
  object-fit: contain;
  border: 0;
}
.attachment-preview audio {
  width: 100%;
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

.vault-page.app-shell--sidebar-collapsed > :deep(.app-shell-sidebar) {
  align-items: center;
  gap: 0.35rem;
  padding: 0.5rem 0.25rem;
}

.vault-page.app-shell--sidebar-collapsed .vault-brand-row,
.vault-page.app-shell--sidebar-collapsed .vault-heading,
.vault-page.app-shell--sidebar-collapsed .tag-filter,
.vault-page.app-shell--sidebar-collapsed :deep(.vault-tree),
.vault-page.app-shell--sidebar-collapsed :deep(.vault-tree-empty) {
  display: none;
}

.vault-page.app-shell--sidebar-collapsed .vault-nav-header {
  display: contents;
}

.vault-page.app-shell--sidebar-collapsed .vault-toolbar-row {
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  order: 2;
}

.vault-page.app-shell--sidebar-collapsed .vault-notes-section-header {
  order: 1;
}

.vault-page.app-shell--sidebar-collapsed .sidebar-footer {
  order: 3;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  margin-top: auto;
  padding-top: 0.5rem;
  border-top: 0;
}

.vault-page.app-shell--sidebar-collapsed .settings-label,
.vault-page.app-shell--sidebar-collapsed .logout-label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.vault-page.app-shell--sidebar-collapsed .settings-button,
.vault-page.app-shell--sidebar-collapsed .logout-button {
  justify-content: center;
  flex: 0 0 auto;
  width: 2rem;
  height: 2rem;
  min-height: 2rem;
  padding: 0;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: var(--synapse-color-surface-raised);
}

.vault-page.app-shell--sidebar-collapsed .settings-button:hover,
.vault-page.app-shell--sidebar-collapsed .settings-button:focus-visible,
.vault-page.app-shell--sidebar-collapsed .logout-button:hover,
.vault-page.app-shell--sidebar-collapsed .logout-button:focus-visible {
  color: var(--synapse-color-text);
  border-color: color-mix(
    in srgb,
    var(--synapse-color-accent) 35%,
    var(--synapse-color-border)
  );
  background: var(--synapse-color-surface-muted);
  outline: none;
}

.vault-page > :deep(.app-shell-content) {
  padding: 0;
}

.vault-page > :deep(.app-shell-assistant) {
  padding: 1.25rem 1rem;
}

.vault-nav-header {
  display: grid;
  gap: 0.75rem;
}

.vault-toolbar-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.vault-toolbar-row :deep(.vault-explorer-toolbar) {
  flex: 1 1 auto;
}

.vault-page--compact .brand-name,
.vault-page--compact .settings-label,
.vault-page--compact .logout-label,
.vault-page--compact :deep(.theme-toggle-label) {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.vault-page--compact .settings-button,
.vault-page--compact .logout-button {
  justify-content: center;
  min-height: 2.35rem;
  padding-inline: 0.7rem;
}

.vault-page--compact .vault-brand-row,
.vault-page--compact .vault-nav-header {
  gap: 0.5rem;
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
  display: flex;
  flex-direction: row;
  align-items: center;
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
  flex: 1 1 0;
  min-width: 0;
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

.settings-button:hover,
.settings-button:focus-visible {
  color: var(--synapse-color-text);
  background: color-mix(
    in srgb,
    var(--synapse-color-border) 40%,
    var(--synapse-color-surface-muted)
  );
}

.settings-button[aria-expanded="true"] {
  color: var(--synapse-color-accent-strong);
  background: var(--synapse-color-surface-accent);
  font-weight: 650;
}

.settings-button[aria-expanded="true"]:hover,
.settings-button[aria-expanded="true"]:focus-visible {
  color: var(--synapse-color-accent-strong);
  background: color-mix(
    in srgb,
    var(--synapse-color-accent) 10%,
    var(--synapse-color-surface-accent)
  );
}

.logout-button:hover,
.logout-button:focus-visible {
  color: var(--synapse-color-danger);
  background: color-mix(
    in srgb,
    var(--synapse-color-danger) 14%,
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
