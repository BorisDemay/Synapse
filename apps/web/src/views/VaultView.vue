<script setup lang="ts">
import LocalFolderPanel from "./LocalFolderPanel.vue";
import DeletedItemsPanel from "./DeletedItemsPanel.vue";
import {
  AiChat,
  AiConversationPanel,
  AppShell,
  BacklinksPanel,
  ConflictResolver,
  DialogFocusController,
  GraphPanel,
  NoteRelationsPanel,
  MarkdownEditor,
  SearchPalette,
  SettingsPanel,
  ThemeToggle,
  VaultExplorerToolbar,
  VaultNotesSectionHeader,
  VaultTree,
  useSidebarLayout,
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
  type QueryNote,
  type SettingsSession,
  type SettingsUser,
  type VaultTreeNode,
} from "@synapse/ui";
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import { useRouter } from "vue-router";

import Button from "primevue/button";

import { isTrustedDeviceSupported } from "../crypto/trusted-device";
import { uuidV7 } from "../crypto/vault-key";
import { ASSISTANT_PROVIDERS } from "../ai/providers";
import { buildMarkdownZip } from "../export/markdown-zip";
import { applyMarkdownImport, type ImportProgress } from "../import/apply";
import {
  planMarkdownImport,
  planZipImport,
  type MarkdownImportPlan,
} from "../import/markdown-folder";
import { useAssistantStore } from "../stores/assistant";
import { useAuthStore } from "../stores/auth";
import { useVaultStore, type DeletedItemRow } from "../stores/vault";

const vault = useVaultStore();
const auth = useAuthStore();
const assistant = useAssistantStore();
const router = useRouter();
const content = ref("# Nouvelle note\n\n");
const noteId = ref<string>(uuidV7());
const selectedNoteId = ref<string | null>(null);
const formError = ref("");
const editorSurface = ref<InstanceType<typeof MarkdownEditor> | null>(null);
const shell = ref<InstanceType<typeof AppShell> | null>(null);
const assistantOpen = ref(false);
const assistantHistoryOpen = ref(false);
const noteHistoryOpen = ref(false);
const compactAssistant = useCompactAssistantLayout();
compactAssistant.bindSidePanels({
  historyOpen: assistantHistoryOpen,
  relationsOpen: noteHistoryOpen,
});
const graphOpen = ref(false);
const settingsOpen = ref(false);
const searchQuery = ref("");
const searchPalette = ref<InstanceType<typeof SearchPalette>>();
const tagFilter = ref("");
const blobUrls = ref<Record<string, string>>({});
const theme = useTheme();
const sidebar = useSidebarLayout();
const deviceTrusted = ref(false);
const deviceSupported = isTrustedDeviceSupported();
const settingsError = ref("");
const settingsStatus = ref("");
const accountEmail = ref("");
const sessions = ref<SettingsSession[]>([]);
const users = ref<SettingsUser[]>([]);
const invitationLink = ref("");
const importInput = ref<HTMLInputElement>();
const importFolderInput = ref<HTMLInputElement>();
const importPlan = ref<MarkdownImportPlan | null>(null);
const importProgress = ref<ImportProgress | null>(null);
const importCancelled = ref(false);
const deletedItemsOpen = ref(false);
const deletedItems = ref<DeletedItemRow[]>([]);
const deletedItemsLoading = ref(false);
const deletedItemsError = ref("");
const restoringDeletedItem = ref(false);
const deletingIds = new Set<string>();
const lastDeletedItem = ref<{ id: string; label: string } | null>(null);
let vaultViewEpoch = 0;
let deletedListRequest = 0;
const attachmentPreview = ref<{
  contentType: string;
  name: string;
  url: string;
} | null>(null);
const attachmentDialog = ref<HTMLElement>();
const attachmentFocus = new DialogFocusController({
  getContainer: () => attachmentDialog.value ?? null,
  onEscape: () => {
    attachmentPreview.value = null;
  },
});
watch(attachmentPreview, async (preview) => {
  if (preview) {
    await nextTick();
    if (attachmentPreview.value) attachmentFocus.attach();
  } else attachmentFocus.detach();
});
const draftBaseRevision = ref<number | null>(null);
const pendingSaves = reactive(
  new Map<string, { content: string; baseRevision: number; noteId: string }>(),
);
const localSaveFailed = ref(false);
let saveInFlight: Promise<boolean> | undefined;

const storageHealthMessage = computed(() => {
  const health = auth.storageHealth;
  if (!health) return "";
  const available =
    health.availableBytes === null
      ? "inconnue"
      : `${Math.round(health.availableBytes / 1024 / 1024)} MiB disponibles`;
  const pending = `${health.pendingOperationCount} opération${health.pendingOperationCount === 1 ? "" : "s"} en attente`;
  const backup = health.lastSuccessfulBackup
    ? ` · sauvegarde ${health.lastSuccessfulBackup}`
    : "";
  return `${available} · ${pending}${backup}`;
});

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

/** Keeps the full vault-relative path: folders drive the tree, templates and
 * wikilink placement, so it must never be reduced to the root filename. */
function fullNotePath(path: string | undefined, id: string): string {
  return path && path.trim() ? path : `${id.slice(0, 8)}.md`;
}

const queryNotes = computed<QueryNote[]>(() =>
  Array.from(vault.notes.entries()).map(([id, note]) => ({
    content: note.content,
    id,
    label: noteTitle(note.content, id.slice(0, 8)),
    path: fullNotePath(note.path, id),
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
      updatedAt: noteUpdatedAt(
        note.id,
        note.content,
        vault.historyFor(note.id)[0]?.recordedAt,
      ),
    }));
  const attached = Array.from(vault.attachments.entries()).map(
    ([id, file]) => ({
      id,
      kind: "attachment" as const,
      label: file.path.split("/").pop() ?? file.path,
      path: file.path,
      syncStatus: vault.noteSyncStatus(id),
      updatedAt: noteUpdatedAt(id, ""),
    }),
  );
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
  { id: "export", label: "Exporter Markdown" },
  { id: "from-template", label: "Créer une note depuis un modèle" },
  { id: "graph", label: "Afficher le graphe local" },
  { id: "import", label: "Importer un ZIP ou un dossier Markdown" },
  { id: "toggle-sidebar", label: "Afficher ou masquer la barre latérale" },
  { id: "toggle-compact", label: "Afficher ou masquer les titres de section" },
]);

const allTags = computed(() => uniqueTags(queryNotes.value));

const propertySummary = computed(() => {
  const values = new Map<string, Set<string>>();
  for (const note of queryNotes.value) {
    for (const [key, value] of Object.entries(
      parseNote(note.content).properties,
    )) {
      const bucket = values.get(key) ?? new Set<string>();
      for (const entry of Array.isArray(value) ? value : [value]) {
        if (entry) bucket.add(entry);
      }
      values.set(key, bucket);
    }
  }
  return [...values.entries()]
    .map(([key, values]) => ({ key, values: [...values].sort() }))
    .sort((left, right) => left.key.localeCompare(right.key, "fr"));
});

const pinnedNotes = computed(() =>
  vault.preferences.pinnedNoteIds
    .map((id) => queryNotes.value.find((note) => note.id === id))
    .filter((note): note is QueryNote => Boolean(note)),
);

const recentNotes = computed(() =>
  vault.preferences.recentNoteIds
    .map((id) => queryNotes.value.find((note) => note.id === id))
    .filter((note): note is QueryNote => Boolean(note))
    .slice(0, 8),
);

const treeSelectedId = computed(() =>
  selectedNoteId.value && vault.notes.has(selectedNoteId.value)
    ? selectedNoteId.value
    : null,
);

const currentQueryNote = computed(() =>
  queryNotes.value.find((note) => note.id === noteId.value),
);

const currentNoteTitle = computed(() =>
  noteTitle(content.value, currentQueryNote.value?.label ?? "Nouvelle note"),
);

const breadcrumbSegments = computed(() => {
  const path = vault.notes.get(noteId.value)?.path;
  return path ? path.split("/").filter(Boolean) : [];
});

/**
 * Save feedback must be honest: an unsaved debounce draft, a local save in
 * flight, a durable local save waiting for sync, a synced ack, offline,
 * error and conflict are distinct states. Local-only modes never claim
 * Synchronisé and a pending operation never hides behind Synced.
 */
const SAVE_STATUS_LABELS = {
  conflict: "Conflit à résoudre",
  draft: "Brouillon modifié",
  "durable-pending": "Enregistré localement · synchronisation en attente",
  error: "Échec de l’enregistrement local · brouillon conservé",
  "sync-error": "Enregistré localement · synchronisation indisponible",
  syncing: "Synchronisation…",
  local: "Enregistré localement",
  offline: "Hors ligne · enregistré localement",
  synced: "Synchronisé",
  "saving-local": "Enregistrement local…",
} as const;

type SaveFeedbackState = keyof typeof SAVE_STATUS_LABELS;

const saveFeedbackState = computed<SaveFeedbackState>(() => {
  if (localSaveFailed.value) return "error";
  if (pendingSaves.has(noteId.value)) return "saving-local";
  if (draftBaseRevision.value !== null || !vault.notes.has(noteId.value))
    return "draft";
  if (vault.syncStatus === "conflict") return "conflict";
  if (vault.syncStatus === "error")
    return auth.isLocalMode ? "error" : "sync-error";
  if (auth.isLocalMode) return "local";
  if (vault.syncStatus === "offline" || !navigator.onLine) return "offline";
  if (vault.pendingNoteIds.includes(noteId.value)) return "durable-pending";
  if (vault.syncStatus === "saving") return "syncing";
  if (auth.isLocalMode || auth.isOfflineSession) return "local";
  return "synced";
});

const saveStatusLabel = computed(
  () => SAVE_STATUS_LABELS[saveFeedbackState.value],
);

const SYNC_STATUS_LABELS = {
  saving: "Enregistrement…",
  synced: "Synchronisé",
  offline: "Hors ligne",
  conflict: "Conflit",
  error: "Erreur",
} as const;

const syncStatusLabel = computed(() =>
  auth.isLocalMode
    ? vault.syncStatus === "error"
      ? "Erreur locale"
      : "Sur cet appareil"
    : SYNC_STATUS_LABELS[vault.syncStatus],
);

const showEmptyState = computed(
  () => !vault.notes.size && isNewNoteDraft(content.value),
);

const AUTOSAVE_HINT_STORAGE_KEY = "synapse-autosave-hint-dismissed";

function readAutosaveHintDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(AUTOSAVE_HINT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

const autosaveHintDismissed = ref(readAutosaveHintDismissed());

function dismissAutosaveHint() {
  autosaveHintDismissed.value = true;
  try {
    window.sessionStorage.setItem(AUTOSAVE_HINT_STORAGE_KEY, "true");
  } catch {
    // Session storage unavailable: keep the dismissal for this mount only.
  }
}

const currentBacklinks = computed(() => {
  const current = currentQueryNote.value;
  return current ? backlinksFor(queryNotes.value, current) : [];
});

const localGraph = computed(() => buildLocalGraph(queryNotes.value));

const templateNotes = computed(() => {
  const prefix = `${vault.preferences.templatesPath.replace(/\/$/u, "")}/`;
  return queryNotes.value.filter((note) => note.path.startsWith(prefix));
});

const importCollisions = computed(() => {
  if (!importPlan.value) return [];
  const notePaths = new Set(
    Array.from(vault.notes.values()).map((note) => note.path),
  );
  const attachmentPaths = new Set(
    Array.from(vault.attachments.values()).map((attachment) => attachment.path),
  );
  return [
    ...importPlan.value.notes
      .filter((note) => notePaths.has(note.path))
      .map((note) => note.path),
    ...importPlan.value.attachments
      .filter((attachment) => attachmentPaths.has(attachment.path))
      .map((attachment) => attachment.path),
  ];
});

watch([noteId, noteHistoryOpen], ([id, open]) => {
  if (open && id && vault.isUnlocked) void vault.loadHistory(id);
});

const historyEntries = computed(() =>
  vault.historyFor(noteId.value).map((entry) => ({
    label: `Révision ${entry.revision}`,
    recordedAt: entry.recordedAt,
    revision: entry.revision,
  })),
);

const restorePoints = computed(() => vault.restorePointsFor(noteId.value));

function focusEditorSoon() {
  void nextTick(() => {
    editorSurface.value?.focus?.();
  });
}

async function closeMobileNavigation() {
  await shell.value?.closeNavigation();
}

function closeNoteTools() {
  assistantOpen.value = false;
  graphOpen.value = false;
  noteHistoryOpen.value = false;
}

/** Only one side tool (relations OR graph OR assistant) may be open. */
function toggleNoteTools(tool: "relations" | "graph" | "assistant") {
  if (tool === "relations") {
    noteHistoryOpen.value = !noteHistoryOpen.value;
    if (noteHistoryOpen.value) {
      graphOpen.value = false;
      assistantOpen.value = false;
    }
  } else if (tool === "graph") {
    graphOpen.value = !graphOpen.value;
    if (graphOpen.value) {
      noteHistoryOpen.value = false;
      assistantOpen.value = false;
    }
  } else {
    assistantOpen.value = !assistantOpen.value;
    if (assistantOpen.value) {
      graphOpen.value = false;
      noteHistoryOpen.value = false;
    }
  }
}

async function selectNote(id: string, shouldFocus = true) {
  const attached = vault.attachments.get(id);
  if (attached) {
    const url = blobUrls.value[attached.path];
    if (url) {
      const name = attached.path.split("/").pop() ?? "fichier";
      if (isSafePreviewType(attached.contentType)) {
        attachmentPreview.value = {
          contentType: attached.contentType,
          name,
          url,
        };
        return;
      }
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
    }
    return;
  }
  if (draftBaseRevision.value !== null && !(await save(content.value))) return;
  draftBaseRevision.value = null;
  selectedNoteId.value = id;
  noteId.value = id;
  content.value = vault.notes.get(id)?.content ?? "";
  void vault.rememberRecentNote(id);
  formError.value = "";
  await closeMobileNavigation();
  if (shouldFocus) await focusEditor();
}

async function focusEditor() {
  await nextTick();
  editorSurface.value?.focus();
}

function isSafePreviewType(contentType: string): boolean {
  return [
    "application/pdf",
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "video/webm",
  ].includes(contentType.toLowerCase());
}

function attachNote(id: string) {
  assistant.attachNote(id);
  graphOpen.value = false;
  noteHistoryOpen.value = false;
  assistantOpen.value = true;
  void closeMobileNavigation();
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
    const noteId = await assistant.send(prompt);
    if (noteId) showNote(noteId);
  } catch {
    // The store already exposes a safe, redacted error.
  }
}

async function showNote(id: string) {
  if (draftBaseRevision.value !== null && !(await save(content.value))) return;
  draftBaseRevision.value = null;
  selectedNoteId.value = id;
  noteId.value = id;
  content.value = vault.notes.get(id)?.content ?? "";
  await closeMobileNavigation();
  await focusEditor();
}

async function startNewNote(folder?: string) {
  if (draftBaseRevision.value !== null && !(await save(content.value))) return;
  draftBaseRevision.value = null;
  noteId.value = uuidV7();
  selectedNoteId.value = null;
  content.value = "# Nouvelle note\n\n";
  formError.value = "";
  await closeMobileNavigation();
  if (folder) {
    void vault.saveNote({
      content: content.value,
      id: noteId.value,
      path: `${folder.replace(/\/$/u, "")}/nouvelle.md`,
    });
    selectedNoteId.value = noteId.value;
  }
  await focusEditor();
}

async function startFromTemplate() {
  if (!templateNotes.value.length) {
    formError.value =
      "Créez une note dans le dossier de modèles configuré d’abord.";
    return;
  }
  const choices = templateNotes.value
    .map((note, index) => `${index + 1}. ${note.label}`)
    .join("\n");
  const answer = window.prompt(`Choisir un modèle :\n${choices}`, "1");
  const index = Number(answer) - 1;
  const template = templateNotes.value[index];
  if (!template) return;
  const id = uuidV7();
  const title =
    window.prompt("Titre de la note", template.label) || template.label;
  const path = `${title.replaceAll("/", "-").trim() || "nouvelle"}.md`;
  const markdown = renderTemplate(template.content, {
    date: new Date(),
    title,
  });
  await vault.saveNote({ content: markdown, id, path });
  selectNote(id);
}

async function deleteNote(id: string) {
  if (deletingIds.has(id)) return;
  if (vault.activeConflict?.noteId === id) {
    formError.value =
      "Résolvez le conflit de cette note avant de la supprimer.";
    return;
  }
  deletingIds.add(id);
  const epoch = vaultViewEpoch;
  formError.value = "";
  try {
    // Flush before the tombstone so Undo can recover the latest visible draft.
    if (
      (draftBaseRevision.value !== null || pendingSaves.size || saveInFlight) &&
      !(await save(content.value))
    )
      return;
    if (epoch !== vaultViewEpoch || !vault.isUnlocked) return;
    const label =
      queryNotes.value.find((note) => note.id === id)?.label ??
      vault.attachments.get(id)?.path.split("/").pop() ??
      "Élément";
    await vault.deleteNote(id);
    if (epoch !== vaultViewEpoch || !vault.isUnlocked) return;
    assistant.detachNote(id);
    lastDeletedItem.value = { id, label };
    if (selectedNoteId.value === id || noteId.value === id) {
      draftBaseRevision.value = null;
      await startNewNote();
    }
  } catch {
    if (epoch === vaultViewEpoch)
      formError.value =
        "Suppression impossible. Votre contenu est conservé ; réessayez.";
  } finally {
    deletingIds.delete(id);
  }
}

function closeDeletedItems() {
  deletedListRequest++;
  deletedItemsOpen.value = false;
  deletedItems.value = [];
  deletedItemsError.value = "";
  deletedItemsLoading.value = false;
}

async function refreshDeletedItems() {
  const request = ++deletedListRequest;
  const epoch = vaultViewEpoch;
  deletedItemsLoading.value = true;
  deletedItemsError.value = "";
  try {
    const rows = await vault.listDeletedItems();
    if (
      request === deletedListRequest &&
      epoch === vaultViewEpoch &&
      vault.isUnlocked
    )
      deletedItems.value = rows;
  } catch {
    if (request === deletedListRequest && epoch === vaultViewEpoch)
      deletedItemsError.value =
        "Historique local indisponible. Fermez puis réessayez.";
  } finally {
    if (request === deletedListRequest && epoch === vaultViewEpoch)
      deletedItemsLoading.value = false;
  }
}

async function openDeletedItems() {
  await closeMobileNavigation();
  deletedItemsOpen.value = true;
  await refreshDeletedItems();
}

async function restoreDeletedItem(id: string) {
  if (restoringDeletedItem.value) return;
  const epoch = vaultViewEpoch;
  restoringDeletedItem.value = true;
  deletedItemsError.value = "";
  try {
    await vault.restoreDeletedItem(id);
    if (epoch !== vaultViewEpoch || !vault.isUnlocked) return;
    if (lastDeletedItem.value?.id === id) lastDeletedItem.value = null;
    if (deletedItemsOpen.value) await refreshDeletedItems();
    else if (vault.notes.has(id)) await selectNote(id);
  } catch {
    if (epoch === vaultViewEpoch) {
      const message =
        "Restauration impossible. L’élément a changé, son chemin est occupé ou son historique local est indisponible. Réessayez depuis les éléments supprimés.";
      if (deletedItemsOpen.value) deletedItemsError.value = message;
      else formError.value = message;
    }
  } finally {
    if (epoch === vaultViewEpoch) restoringDeletedItem.value = false;
  }
}

function updateDraft(nextContent: string) {
  if (nextContent !== content.value && draftBaseRevision.value === null)
    draftBaseRevision.value = vault.headRevision;
  content.value = nextContent;
}

watch(
  () => vault.notes.get(noteId.value)?.content,
  (next, previous) => {
    if (
      next !== undefined &&
      previous !== undefined &&
      draftBaseRevision.value === null &&
      content.value === previous
    )
      content.value = next;
  },
);

async function save(nextContent = content.value) {
  if (!vault.notes.has(noteId.value) && isNewNoteDraft(nextContent)) {
    return true;
  }
  content.value = nextContent;
  pendingSaves.set(noteId.value, {
    content: nextContent,
    noteId: noteId.value,
    baseRevision: draftBaseRevision.value ?? vault.headRevision,
  });
  if (saveInFlight) {
    return saveInFlight;
  }

  saveInFlight = (async () => {
    while (pendingSaves.size) {
      const currentSave = pendingSaves.values().next().value!;
      formError.value = "";
      try {
        localSaveFailed.value = false;
        await vault.saveNote({
          baseRevision: currentSave.baseRevision,
          content: currentSave.content,
          id: currentSave.noteId,
          path: vault.notes.get(currentSave.noteId)?.path,
        });
        if (pendingSaves.get(currentSave.noteId) === currentSave)
          pendingSaves.delete(currentSave.noteId);
        if (
          noteId.value === currentSave.noteId &&
          content.value === currentSave.content
        )
          draftBaseRevision.value = null;
        if (noteId.value === currentSave.noteId) {
          selectedNoteId.value = currentSave.noteId;
        }
        if (vault.syncStatus === "error" || vault.syncStatus === "conflict") {
          formError.value = vault.lastError ?? "Enregistrement impossible.";
        }
      } catch (error) {
        localSaveFailed.value = true;
        formError.value =
          error instanceof Error ? error.message : "Enregistrement impossible.";
        return false;
      }
    }
    return true;
  })().finally(() => {
    saveInFlight = undefined;
  });

  return saveInFlight;
}

async function onOnline() {
  await vault.synchronize();
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
  if (
    (draftBaseRevision.value !== null || pendingSaves.size) &&
    !(await save(content.value))
  )
    return;
  try {
    await auth.logout();
  } finally {
    await router.replace("/login");
  }
}

async function refreshDeviceTrust() {
  if (!vault.currentVaultId) {
    deviceTrusted.value = false;
    return;
  }
  deviceTrusted.value = await vault.hasTrustedDevice(vault.currentVaultId);
}

async function forgetDevice() {
  if (!vault.currentVaultId) {
    return;
  }
  if (
    !confirm(
      "Oublier cet appareil exigera la phrase de déchiffrement au prochain chargement.",
    )
  ) {
    return;
  }
  await vault.forgetTrustedDevice(vault.currentVaultId);
  deviceTrusted.value = false;
}

async function rememberDevice() {
  try {
    await vault.rememberCurrentDevice();
    deviceTrusted.value = true;
  } catch {
    formError.value = "Impossible d’enregistrer cet appareil.";
  }
}

async function lockVault() {
  if (
    (draftBaseRevision.value !== null || pendingSaves.size) &&
    !(await save(content.value))
  )
    return;
  settingsOpen.value = false;
  vault.lockAndRequirePassphrase();
  await router.push("/unlock");
}

async function loadAccountSettings() {
  settingsError.value = "";
  if (auth.isOfflineSession || auth.isLocalMode) {
    return;
  }
  try {
    const listed = await auth.listSessions();
    accountEmail.value = listed.email;
    sessions.value = listed.sessions;
    if (auth.isAdmin) users.value = await auth.listUsers();
  } catch {
    settingsError.value = "Impossible de charger les sessions.";
  }
}

async function createInvitation(email: string) {
  settingsError.value = "";
  settingsStatus.value = "";
  try {
    const invitation = await auth.createInvitation(email);
    invitationLink.value = `${window.location.origin}/register?invitation=${encodeURIComponent(invitation.token)}`;
    settingsStatus.value = `Invitation créée pour ${invitation.email}.`;
    users.value = await auth.listUsers();
  } catch {
    settingsError.value = "Impossible de créer l’invitation.";
  }
}

function openAdminConsole() {
  settingsOpen.value = false;
  void router.push("/admin");
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

async function saveVaultPreferences(templatesPath: string) {
  settingsError.value = "";
  try {
    await vault.savePreferences({
      ...vault.preferences,
      templatesPath,
    });
    settingsStatus.value = "Préférences du coffre enregistrées localement.";
  } catch (error) {
    settingsError.value =
      error instanceof Error
        ? error.message
        : "Préférences impossibles à enregistrer.";
  }
}

async function exportNotes() {
  settingsError.value = "";
  try {
    await save();
    const zip = buildMarkdownZip(
      vault.markdownExportNotes(),
      vault.markdownExportAttachments(),
    );
    const blob = new Blob([zip], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "synapse-notes.zip";
    link.click();
    URL.revokeObjectURL(url);
    settingsStatus.value = "Export Markdown téléchargé.";
  } catch {
    settingsError.value = "Export impossible.";
  }
}

function requestImport() {
  importInput.value?.click();
}

function requestFolderImport() {
  importFolderInput.value?.click();
}

async function previewImport(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if (!files.length) {
    return;
  }
  try {
    if (files.length === 1 && files[0]?.name.toLowerCase().endsWith(".zip")) {
      importPlan.value = await planZipImport(
        new Uint8Array(await files[0].arrayBuffer()),
      );
      return;
    }
    importPlan.value = planMarkdownImport(
      await Promise.all(
        files.map(async (file) => ({
          bytes: new Uint8Array(await file.arrayBuffer()),
          contentType: file.type,
          path: file.webkitRelativePath || file.name,
        })),
      ),
    );
  } catch (error) {
    formError.value =
      error instanceof Error ? error.message : "Import impossible.";
  }
}

async function confirmImport() {
  const plan = importPlan.value;
  if (
    !plan ||
    !confirm(
      `Importer ${plan.notes.length} notes et ${plan.attachments.length} pièces jointes ?`,
    )
  ) {
    return;
  }
  formError.value = "";
  importCancelled.value = false;
  importProgress.value = {
    completed: 0,
    total: plan.notes.length + plan.attachments.length,
  };
  try {
    const result = await applyMarkdownImport(
      plan,
      {
        findNoteId: (path) =>
          [...vault.notes.entries()].find(
            ([, note]) => note.path === path,
          )?.[0],
        saveAttachment: async (attachment) => {
          await vault.saveAttachment(attachment);
        },
        saveNote: async (note, existingId) => {
          await vault.saveNote({
            content: note.content,
            id: existingId ?? uuidV7(),
            path: note.path,
          });
        },
      },
      {
        isCancelled: () => importCancelled.value,
        onProgress: (progress) => {
          importProgress.value = progress;
        },
      },
    );
    if (result.cancelled) {
      formError.value = `Import interrompu après ${result.completed} élément${result.completed === 1 ? "" : "s"}.`;
    } else {
      importPlan.value = null;
    }
  } catch (error) {
    formError.value =
      error instanceof Error ? error.message : "Import interrompu.";
  } finally {
    importProgress.value = null;
  }
}

function cancelImport() {
  if (importProgress.value) {
    importCancelled.value = true;
    return;
  }
  importPlan.value = null;
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
  } else if (id === "export") {
    void exportNotes();
  } else if (id === "from-template") {
    void startFromTemplate();
  } else if (id === "graph") {
    assistantOpen.value = false;
    noteHistoryOpen.value = false;
    graphOpen.value = true;
  } else if (id === "import") {
    requestImport();
  } else if (id === "toggle-sidebar") {
    sidebar.toggleCollapsed();
  } else if (id === "toggle-compact") {
    sidebar.toggleCompact();
  }
}

async function openLocalSearch(query = "") {
  await closeMobileNavigation();
  await searchPalette.value?.openPalette(query);
}

async function saveSearch() {
  const query = searchQuery.value.trim();
  if (!query) return;
  const label = window.prompt("Nom de la recherche", query);
  if (!label?.trim()) return;
  await vault.savePreferences({
    ...vault.preferences,
    savedSearches: [
      ...vault.preferences.savedSearches.filter(
        (search) => search.query !== query,
      ),
      { id: uuidV7(), label: label.trim(), query },
    ],
  });
}

async function toggleCurrentPin() {
  if (vault.notes.has(noteId.value)) {
    await vault.togglePinnedNote(noteId.value);
  }
}

async function openWikilink(target: string) {
  const existing = resolveWikilink(queryNotes.value, target);
  if (existing) {
    selectNote(existing.id);
    return;
  }
  const path = wikilinkPath(
    target,
    fullNotePath(vault.notes.get(noteId.value)?.path, "nouvelle"),
  );
  const id = uuidV7();
  const markdown = `# ${target}\n\n`;
  await vault.saveNote({ content: markdown, id, path });
  selectNote(id);
}

async function attachFiles(files: File[]) {
  for (const file of files) {
    const name = sanitizeAttachmentFileName(file.name);
    const path = `attachments/${name}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await vault.saveAttachment({
        bytes,
        contentType: file.type || "application/octet-stream",
        path,
      });
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
  }
}

async function restoreHistory(revision: number) {
  try {
    await vault.restoreRevision(noteId.value, revision);
    content.value = vault.notes.get(noteId.value)?.content ?? content.value;
  } catch (error) {
    formError.value =
      error instanceof Error ? error.message : "Restauration impossible.";
  }
}

async function createRestorePoint() {
  const label = window.prompt("Nom du restore point");
  if (!label?.trim()) return;
  try {
    await vault.createRestorePoint(noteId.value, label);
  } catch (error) {
    formError.value =
      error instanceof Error ? error.message : "Restore point impossible.";
  }
}

function refreshBlobUrls() {
  for (const url of Object.values(blobUrls.value)) {
    URL.revokeObjectURL(url);
  }
  const next: Record<string, string> = {};
  for (const file of vault.attachments.values()) {
    next[file.path] = URL.createObjectURL(
      new Blob([file.bytes], { type: file.contentType }),
    );
  }
  blobUrls.value = next;
}

onMounted(() => {
  window.addEventListener("online", onOnline);
  if (navigator.onLine) {
    void vault.synchronize();
  }
  if (vault.isUnlocked) {
    void assistant.restore();
  }
  void auth.refreshStorageHealth();
  void refreshDeviceTrust();
  void reopenMostRecentNote();
});

/** Reopens the most recent note that still exists, from the encrypted vault
 * preferences (recentNoteIds), never from plaintext localStorage. */
async function reopenMostRecentNote() {
  if (!vault.isUnlocked || vault.notes.has(noteId.value)) return;
  if (vault.preferences.recentNoteIds.length === 0) return;
  const mostRecent = vault.preferences.recentNoteIds.find((id) =>
    vault.notes.has(id),
  );
  if (mostRecent) await selectNote(mostRecent, false);
}

onUnmounted(() => {
  attachmentFocus.detach();
  vaultViewEpoch++;
  closeDeletedItems();
  window.removeEventListener("online", onOnline);
  for (const url of Object.values(blobUrls.value)) {
    URL.revokeObjectURL(url);
  }
});

watch(
  [() => vault.isUnlocked, () => vault.currentVaultId, () => auth.userId],
  () => {
    vaultViewEpoch++;
    closeDeletedItems();
    lastDeletedItem.value = null;
    restoringDeletedItem.value = false;
  },
);

watch(
  () => vault.isUnlocked,
  (unlocked) => {
    if (unlocked) {
      void assistant.restore();
      return;
    }
    draftBaseRevision.value = null;
    pendingSaves.clear();
    localSaveFailed.value = false;
    content.value = "";
    attachmentPreview.value = null;
    importPlan.value = null;
    settingsOpen.value = false;
    closeNoteTools();
    assistant.lockSession();
  },
);

watch(
  () => [...vault.attachments.values()].map((file) => file.path).join("|"),
  () => refreshBlobUrls(),
);

watch(settingsOpen, (open) => {
  if (!open) {
    invitationLink.value = "";
    return;
  }
  settingsStatus.value = "";
  settingsError.value = "";
  void loadAccountSettings();
});
</script>

<template>
  <AppShell
    ref="shell"
    class="vault-page"
    :class="{ 'vault-page--compact': sidebar.compact.value }"
    :sidebar-collapsed="sidebar.collapsed.value"
    :tool-open="assistantOpen || graphOpen || noteHistoryOpen"
    @close-tool="closeNoteTools"
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
            <h1>Coffre</h1>
          </div>
          <span class="sync-pill" :data-status="vault.syncStatus" role="status">
            <span class="sync-dot" aria-hidden="true" />
            {{ syncStatusLabel }}
          </span>
        </div>
        <p v-if="storageHealthMessage" class="storage-health" role="status">
          {{ storageHealthMessage }}
        </p>
        <VaultExplorerToolbar
          show-import
          show-import-folder
          show-template
          :compact="sidebar.compact.value"
          :sidebar-collapsed="sidebar.collapsed.value"
          @from-template="startFromTemplate"
          @import="requestImport"
          @import-folder="requestFolderImport"
          @toggle-compact="sidebar.toggleCompact()"
          @toggle-sidebar="sidebar.toggleCollapsed()"
        />
        <input
          ref="importInput"
          accept=".zip"
          hidden
          type="file"
          @change="previewImport"
        />
        <input
          ref="importFolderInput"
          hidden
          multiple
          type="file"
          webkitdirectory=""
          @change="previewImport"
        />
        <button
          class="vault-search-trigger"
          type="button"
          @click="openLocalSearch()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z"
            />
          </svg>
          <span class="vault-search-label">Rechercher dans les notes</span>
          <kbd class="vault-search-shortcut">Ctrl+K</kbd>
        </button>
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
      <section
        v-if="!sidebar.collapsed.value && propertySummary.length"
        class="property-browser"
        aria-label="Propriétés"
      >
        <div class="sidebar-section-label" v-if="!sidebar.compact.value">
          PROPRIÉTÉS
        </div>
        <button
          v-for="property in propertySummary"
          :key="property.key"
          class="sidebar-nav-item"
          type="button"
          @click="openLocalSearch(`property:${property.key}`)"
        >
          {{ property.key }} <small>{{ property.values.length }}</small>
        </button>
      </section>
      <section
        v-if="!sidebar.collapsed.value && pinnedNotes.length"
        class="pinned-notes"
        aria-label="Notes épinglées"
      >
        <div class="sidebar-section-label" v-if="!sidebar.compact.value">
          ÉPINGLÉES
        </div>
        <button
          v-for="note in pinnedNotes"
          :key="note.id"
          class="sidebar-nav-item"
          type="button"
          :data-active="selectedNoteId === note.id ? 'true' : undefined"
          @click="selectNote(note.id)"
        >
          {{ note.label }}
        </button>
      </section>
      <section
        v-if="
          !sidebar.collapsed.value && vault.preferences.savedSearches.length
        "
        class="saved-searches"
        aria-label="Recherches sauvegardées"
      >
        <div class="sidebar-section-label" v-if="!sidebar.compact.value">
          RECHERCHES
        </div>
        <button
          v-for="search in vault.preferences.savedSearches"
          :key="search.id"
          class="sidebar-nav-item"
          type="button"
          @click="openLocalSearch(search.query)"
        >
          {{ search.label }}
        </button>
      </section>
      <section
        v-if="!sidebar.collapsed.value && recentNotes.length"
        class="recent-notes"
        aria-label="Notes récentes"
      >
        <div class="sidebar-section-label" v-if="!sidebar.compact.value">
          RÉCENTES
        </div>
        <button
          v-for="note in recentNotes"
          :key="note.id"
          class="sidebar-nav-item"
          type="button"
          :data-active="selectedNoteId === note.id ? 'true' : undefined"
          @click="selectNote(note.id)"
        >
          {{ note.label }}
        </button>
      </section>
      <VaultNotesSectionHeader
        :compact="sidebar.compact.value"
        :collapsed="sidebar.collapsed.value"
        @new-note="startNewNote()"
      />
      <VaultTree
        v-if="!sidebar.collapsed.value"
        :attached-ids="assistant.attachedNoteIds"
        :nodes="treeNodes"
        :selected-id="treeSelectedId"
        @attach="attachNote"
        @delete="deleteNote"
        @select="selectNote"
      />
      <div class="sidebar-footer">
        <button
          class="deleted-items-trigger"
          type="button"
          aria-label="Éléments supprimés"
          title="Éléments supprimés"
          @click="openDeletedItems"
        >
          <span aria-hidden="true">↶</span>
          <span v-if="!sidebar.collapsed.value">Éléments supprimés</span>
        </button>
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
          aria-label="Se déconnecter"
          title="Se déconnecter"
          @click="logout"
        >
          <span aria-hidden="true">↪</span>
          <span class="logout-label">Se déconnecter</span>
        </button>
      </div>
    </template>

    <section class="vault-workspace" aria-label="Édition de note">
      <header class="workspace-header">
        <div class="workspace-titleblock">
          <nav
            v-if="breadcrumbSegments.length"
            class="note-breadcrumb"
            aria-label="Chemin de la note"
          >
            <template
              v-for="(segment, index) in breadcrumbSegments"
              :key="index"
            >
              <span v-if="index" class="breadcrumb-separator" aria-hidden="true"
                >/</span
              >
              <span class="breadcrumb-segment">{{ segment }}</span>
            </template>
          </nav>
          <h2>{{ currentNoteTitle }}</h2>
        </div>
        <div class="workspace-meta">
          <span
            v-if="auth.isOfflineSession && !auth.isLocalMode"
            class="offline-label"
            >Session hors ligne</span
          >
          <span
            class="save-status"
            role="status"
            :data-state="saveFeedbackState"
            >{{ saveStatusLabel }}</span
          >
          <button
            class="workspace-tool"
            type="button"
            :aria-pressed="noteHistoryOpen"
            @click="toggleNoteTools('relations')"
          >
            Relations
          </button>
          <button
            class="workspace-tool"
            type="button"
            :aria-pressed="graphOpen"
            @click="toggleNoteTools('graph')"
          >
            Graphe
          </button>
          <button
            class="workspace-tool"
            type="button"
            :aria-pressed="assistantOpen"
            @click="toggleNoteTools('assistant')"
          >
            Assistant
          </button>
          <button
            class="workspace-tool"
            type="button"
            :aria-pressed="vault.preferences.pinnedNoteIds.includes(noteId)"
            @click="toggleCurrentPin"
          >
            {{
              vault.preferences.pinnedNoteIds.includes(noteId)
                ? "Désépingler"
                : "Épingler"
            }}
          </button>
        </div>
      </header>
      <div v-if="lastDeletedItem" class="deletion-notice" role="status">
        <span>{{ lastDeletedItem.label }} supprimé.</span>
        <button
          type="button"
          aria-label="Annuler la suppression"
          :disabled="restoringDeletedItem"
          @click="restoreDeletedItem(lastDeletedItem.id)"
        >
          Annuler la suppression
        </button>
      </div>
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
      <section
        v-else-if="importPlan"
        class="import-preview"
        aria-labelledby="import-preview-title"
      >
        <h2 id="import-preview-title">Prévisualisation de l’import</h2>
        <p>
          {{ importPlan.notes.length }} notes et
          {{ importPlan.attachments.length }} pièces jointes seront chiffrées
          localement.
        </p>
        <p v-if="importPlan.ignored.length">
          {{ importPlan.ignored.length }} éléments ignorés pour sécurité ou
          compatibilité.
        </p>
        <p v-if="importCollisions.length" class="import-warning" role="status">
          {{ importCollisions.length }} éléments existants seront remplacés.
        </p>
        <p v-if="importProgress" role="status">
          Importation : {{ importProgress.completed }} /
          {{ importProgress.total }} éléments chiffrés localement.
        </p>
        <details>
          <summary>Détails de l’import</summary>
          <ul>
            <li
              v-for="note in importPlan.notes.slice(0, 20)"
              :key="`note-${note.path}`"
            >
              Note : {{ note.path }}
            </li>
            <li
              v-for="attachment in importPlan.attachments.slice(0, 20)"
              :key="`attachment-${attachment.path}`"
            >
              Pièce jointe : {{ attachment.path }}
            </li>
            <li
              v-for="ignored in importPlan.ignored.slice(0, 20)"
              :key="`ignored-${ignored.path}`"
            >
              Ignoré : {{ ignored.path }} — {{ ignored.reason }}
            </li>
          </ul>
        </details>
        <div class="import-preview-actions">
          <Button
            label="Annuler"
            outlined
            type="button"
            @click="cancelImport"
          />
          <Button
            :disabled="Boolean(importProgress)"
            label="Importer"
            type="button"
            @click="confirmImport"
          />
        </div>
      </section>
      <template v-else>
        <section
          v-if="showEmptyState"
          class="vault-empty-state"
          aria-labelledby="empty-state-title"
        >
          <h2 id="empty-state-title">Votre coffre est prêt</h2>
          <p>
            L’éditeur est déjà ouvert : écrivez votre première note ou importez
            un coffre Markdown existant.
          </p>
          <div class="vault-empty-actions">
            <button
              class="workspace-tool"
              data-test="empty-state-write"
              type="button"
              @click="focusEditorSoon()"
            >
              Écrire
            </button>
            <button
              class="workspace-tool"
              data-test="empty-state-import"
              type="button"
              @click="requestImport()"
            >
              Importer
            </button>
          </div>
          <p v-if="!autosaveHintDismissed" class="autosave-hint" role="note">
            L’enregistrement automatique garde vos notes dans le coffre chiffré
            local, même hors ligne.
            <button
              data-test="autosave-hint-dismiss"
              type="button"
              @click="dismissAutosaveHint"
            >
              Masquer pour cette session
            </button>
          </p>
        </section>
        <div class="editor-surface">
          <MarkdownEditor
            ref="editorSurface"
            :model-value="content"
            @update:model-value="updateDraft"
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
      <div v-if="searchQuery" class="saved-search-action">
        <Button
          label="Enregistrer la recherche"
          outlined
          type="button"
          @click="saveSearch"
        />
      </div>
    </section>
    <template #relations v-if="graphOpen || noteHistoryOpen">
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
        :restore-points="restorePoints"
        @close="noteHistoryOpen = false"
        @create-restore-point="createRestorePoint"
        @restore="restoreHistory"
        @select="selectNote"
      />
    </template>
    <template #assistant v-if="assistantOpen">
      <div v-if="assistantHistoryOpen" class="assistant-slot">
        <AiConversationPanel
          :active-conversation-id="assistant.activeConversationId"
          :busy="assistant.busy"
          :conversations="assistant.conversationSummaries"
          @close="assistantHistoryOpen = false"
          @new-conversation="assistant.newConversation"
          @open-conversation="assistant.openConversation"
        />
        <button
          class="workspace-tool assistant-back-to-chat"
          type="button"
          @click="assistantHistoryOpen = false"
        >
          Retour à la conversation
        </button>
      </div>
      <AiChat
        v-else
        :attachments="assistant.attachments"
        :busy="assistant.busy"
        :connected="assistant.connected"
        :conversations-panel-open="assistantHistoryOpen"
        :device-login="assistant.deviceLogin"
        :providers="assistantProviders"
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
        @toggle-history="toggleNoteTools('relations')"
        @update:fast="assistant.setFast"
        @update:model="assistant.setModel"
        @update:reasoning-effort="assistant.setReasoningEffort"
      />
    </template>
  </AppShell>
  <LocalFolderPanel />
  <DeletedItemsPanel
    v-if="deletedItemsOpen"
    :open="deletedItemsOpen"
    :items="deletedItems"
    :loading="deletedItemsLoading"
    :restoring="restoringDeletedItem"
    :error="deletedItemsError"
    @close="closeDeletedItems"
    @restore="restoreDeletedItem"
  />
  <SettingsPanel
    :admin="auth.isAdmin"
    :account-email="accountEmail"
    :device-supported="deviceSupported"
    :device-trusted="deviceTrusted"
    :error-message="settingsError"
    :offline="auth.isOfflineSession || auth.isLocalMode"
    :open="settingsOpen"
    :sessions="sessions"
    :users="users"
    :invitation-link="invitationLink"
    :status-message="settingsStatus"
    :templates-path="vault.preferences.templatesPath"
    @change-passphrase="changePassphrase"
    @change-password="changePassword"
    @close="settingsOpen = false"
    @create-invitation="createInvitation"
    @open-admin="openAdminConsole"
    @delete-account="deleteAccount"
    @export-notes="exportNotes"
    @forget-device="forgetDevice"
    @lock-vault="lockVault"
    @remember-device="rememberDevice"
    @revoke-other-sessions="revokeOtherSessions"
    @revoke-session="revokeSession"
    @save-vault-preferences="saveVaultPreferences"
  />
  <SearchPalette
    ref="searchPalette"
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
      ref="attachmentDialog"
      class="attachment-preview"
      role="dialog"
      aria-modal="true"
      :aria-label="`Aperçu ${attachmentPreview.name}`"
      @keydown.escape.prevent="attachmentPreview = null"
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
@media (max-width: 48rem) {
  .workspace-header {
    padding: 0.65rem 0.75rem 0.5rem 3.75rem !important;
    gap: 0.25rem !important;
  }
  .workspace-titleblock h2 {
    font-size: 1.1rem;
  }
  .workspace-header .workspace-meta {
    justify-content: flex-start;
    gap: 0.25rem;
  }
  .workspace-header .save-status {
    flex-basis: 100%;
  }
  .workspace-header .workspace-tool {
    padding: 0.2rem 0.4rem;
  }
}
.deletion-notice {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--synapse-color-surface-muted);
}
.sidebar-footer {
  flex-wrap: wrap;
}
.deleted-items-trigger {
  flex-basis: 100%;
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem;
  color: var(--synapse-color-text-muted);
  background: none;
  border: 0;
  cursor: pointer;
  text-align: start;
}
.vault-page {
  min-height: 100vh;
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
.vault-page.app-shell--sidebar-collapsed .property-browser,
.vault-page.app-shell--sidebar-collapsed .pinned-notes,
.vault-page.app-shell--sidebar-collapsed .saved-searches,
.vault-page.app-shell--sidebar-collapsed :deep(.vault-tree),
.vault-page.app-shell--sidebar-collapsed :deep(.vault-tree-empty) {
  display: none;
}

.vault-page.app-shell--sidebar-collapsed .vault-nav-header {
  display: contents;
}

.vault-page.app-shell--sidebar-collapsed .vault-notes-section-header {
  order: 1;
}

.vault-page.app-shell--sidebar-collapsed .vault-search-trigger {
  width: 2rem;
  min-height: 2rem;
  padding: 0;
  justify-content: center;
}

.vault-page.app-shell--sidebar-collapsed .vault-search-trigger svg {
  margin: 0;
}

.vault-page.app-shell--sidebar-collapsed .vault-search-label,
.vault-page.app-shell--sidebar-collapsed .vault-search-shortcut {
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

.vault-page.app-shell--sidebar-collapsed :deep(.vault-explorer-toolbar) {
  order: 2;
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

.storage-health {
  margin: -0.35rem 0 0;
  color: var(--synapse-color-text-muted);
  font-size: 0.68rem;
  line-height: 1.35;
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

.property-browser,
.pinned-notes,
.saved-searches {
  display: grid;
  gap: 0.15rem;
}

.sidebar-nav-item {
  display: block;
  width: 100%;
  min-height: 2.35rem;
  padding: 0.55rem 0.7rem;
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: transparent;
  text-align: start;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition:
    color 140ms ease,
    background 140ms ease;
}

.sidebar-nav-item:hover,
.sidebar-nav-item:focus-visible {
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-muted);
}

.sidebar-nav-item[data-active="true"] {
  color: var(--synapse-color-accent-strong);
  background: var(--synapse-color-surface-accent);
  font-weight: 650;
}

.sidebar-nav-item small {
  color: var(--synapse-color-text-muted);
  font-weight: 600;
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
  height: 100vh;
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
  min-height: 60vh;
}

.workspace-meta {
  color: var(--synapse-color-text-muted);
  font-size: 0.8rem;
}

.workspace-titleblock {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.note-breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  color: var(--synapse-color-text-muted);
  font-size: 0.72rem;
}

.breadcrumb-separator {
  color: var(--synapse-color-text-muted);
}

.breadcrumb-segment:last-child {
  color: var(--synapse-color-text);
  font-weight: 600;
}

.workspace-tool {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 2rem;
  padding: 0.3rem 0.65rem;
  border: 1px solid transparent;
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: transparent;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    color 140ms ease,
    border-color 140ms ease,
    background 140ms ease;
}

.workspace-tool:hover,
.workspace-tool:focus-visible {
  color: var(--synapse-color-text);
  border-color: var(--synapse-color-border);
  background: var(--synapse-color-surface-muted);
  outline: none;
}

.workspace-tool[aria-pressed="true"] {
  color: var(--synapse-color-accent-strong);
  border-color: color-mix(
    in srgb,
    var(--synapse-color-accent) 35%,
    var(--synapse-color-border)
  );
  background: var(--synapse-color-surface-accent);
}

.save-status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.save-status::before {
  content: "";
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--synapse-color-success);
}

.save-status[data-state="draft"],
.save-status[data-state="syncing"],
.save-status[data-state="saving-local"] {
  color: var(--synapse-color-text-muted);
}

.save-status[data-state="draft"]::before,
.save-status[data-state="saving-local"]::before {
  background: var(--synapse-color-accent);
}

.save-status[data-state="durable-pending"],
.save-status[data-state="local"] {
  color: var(--synapse-color-text-muted);
}

.save-status[data-state="durable-pending"]::before,
.save-status[data-state="local"]::before {
  background: color-mix(
    in srgb,
    var(--synapse-color-success) 55%,
    var(--synapse-color-warning)
  );
}

.save-status[data-state="offline"] {
  color: var(--synapse-color-warning);
}

.save-status[data-state="offline"]::before {
  background: var(--synapse-color-warning);
}

.save-status[data-state="error"],
.save-status[data-state="sync-error"],
.save-status[data-state="conflict"] {
  color: var(--synapse-color-danger);
}

.save-status[data-state="error"]::before,
.save-status[data-state="sync-error"]::before,
.save-status[data-state="conflict"]::before {
  background: var(--synapse-color-danger);
}

.offline-label {
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  color: var(--synapse-color-warning);
  background: color-mix(in srgb, var(--synapse-color-warning) 12%, transparent);
  font-weight: 700;
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

.vault-search-trigger {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  min-height: 2.35rem;
  padding: 0.45rem 0.7rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: var(--synapse-color-surface);
  font: inherit;
  font-size: 0.8rem;
  text-align: start;
  cursor: pointer;
  transition:
    color 140ms ease,
    border-color 140ms ease,
    background 140ms ease;
}

.vault-search-trigger svg {
  flex-shrink: 0;
  width: 1rem;
  height: 1rem;
}

.vault-search-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vault-search-shortcut {
  flex-shrink: 0;
  padding: 0.1rem 0.35rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: var(--synapse-color-surface-raised);
  font-family: inherit;
  font-size: 0.68rem;
}

.vault-search-trigger:hover,
.vault-search-trigger:focus-visible {
  color: var(--synapse-color-text);
  border-color: color-mix(
    in srgb,
    var(--synapse-color-accent) 35%,
    var(--synapse-color-border)
  );
  outline: none;
}

.vault-empty-state {
  display: grid;
  gap: 0.6rem;
  justify-items: start;
  margin: clamp(1rem, 4vh, 3rem) auto 0;
  max-width: 34rem;
  padding: 1.25rem 1.5rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-md);
  background: color-mix(
    in srgb,
    var(--synapse-color-surface-raised) 70%,
    var(--synapse-color-surface)
  );
}

.vault-empty-state h2 {
  margin: 0;
  font-size: 1.15rem;
}

.vault-empty-state p {
  margin: 0;
  color: var(--synapse-color-text-muted);
  font-size: 0.85rem;
  line-height: 1.45;
}

.vault-empty-actions {
  display: flex;
  gap: 0.5rem;
}

.autosave-hint {
  display: grid;
  gap: 0.35rem;
}

.autosave-hint button {
  justify-self: start;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: transparent;
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.autosave-hint button:hover,
.autosave-hint button:focus-visible {
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-muted);
  outline: none;
}

.assistant-slot {
  display: grid;
  gap: 0.75rem;
  align-content: start;
  width: 100%;
  min-width: 0;
}

.assistant-back-to-chat {
  justify-content: center;
}

@media (max-width: 860px) {
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

/* Reserves top-start header space for the fixed mobile navigation toggle that
   the AppShell lane renders itself (its drawer is closed by default at ≤768px,
   so the toggle overlays the workspace header on narrow viewports). */
@media (max-width: 768px) {
  .workspace-header {
    padding-inline-start: 3.75rem;
  }
}
</style>
