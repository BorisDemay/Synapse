<script setup lang="ts">
import LocalFolderPanel from "./LocalFolderPanel.vue";
import DeletedItemsPanel from "./DeletedItemsPanel.vue";
import QuickAssistantPrompt from "../components/QuickAssistantPrompt.vue";
import {
  AiChat,
  AiConversationPanel,
  AppShell,
  ConflictResolver,
  DialogFocusController,
  HistoryPanel,
  isDialogElementVisible,
  MarkdownEditor,
  SearchPalette,
  SettingsPanel,
  ThemeToggle,
  VaultContextMenu,
  VaultExplorerToolbar,
  VaultNotesSectionHeader,
  VaultTree,
  useSidebarLayout,
  useCompactAssistantLayout,
  buildVaultTree,
  downloadNotePdf,
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
  pushOverlay,
  type MarkdownMenuItem,
  type OverlayHandle,
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
import { useRoute, useRouter } from "vue-router";

import Button from "primevue/button";

import { isTrustedDeviceSupported } from "../crypto/trusted-device";
import { uuidV7 } from "../crypto/vault-key";
import { ASSISTANT_PROVIDERS } from "../ai/providers";
import {
  buildMarkdownZip,
  markdownExportFilename,
} from "../export/markdown-zip";
import { applyMarkdownImport, type ImportProgress } from "../import/apply";
import {
  planMarkdownImport,
  planZipImport,
  type MarkdownImportPlan,
} from "../import/markdown-folder";
import { clearToasts, dismissToast, notify } from "../notifications/toasts";
import { useAssistantStore } from "../stores/assistant";
import { useAuthStore } from "../stores/auth";
import {
  useVaultStore,
  type DeletedItemRow,
  type NoteEditBase,
} from "../stores/vault";

const vault = useVaultStore();
const auth = useAuthStore();
const assistant = useAssistantStore();
const router = useRouter();
const route = useRoute();
const content = ref("");
const noteId = ref<string>(uuidV7());
const selectedNoteId = ref<string | null>(null);
const formError = ref("");
const editorSurface = ref<InstanceType<typeof MarkdownEditor> | null>(null);
const shell = ref<InstanceType<typeof AppShell> | null>(null);
const assistantOpen = ref(false);
const assistantHistoryOpen = ref(false);
const quickAssistantOpen = ref(false);
const noteHistoryOpen = ref(false);
const compactAssistant = useCompactAssistantLayout();
compactAssistant.bindSidePanels({
  historyOpen: assistantHistoryOpen,
  relationsOpen: noteHistoryOpen,
});
const settingsOpen = ref(false);
const searchQuery = ref("");
const searchPalette = ref<InstanceType<typeof SearchPalette>>();
const searchPaletteOpen = ref(false);
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
let lastDeletionToastId: number | null = null;
let errorToastId: number | null = null;
let quickAssistantToastId: number | null = null;
const quickAssistantInFlight = ref(false);
let quickAssistantRunId: symbol | null = null;
let vaultViewEpoch = 0;

watch(
  () => formError.value || vault.lastError,
  (message) => {
    if (errorToastId !== null) dismissToast(errorToastId);
    errorToastId =
      message && vault.isUnlocked
        ? notify({
            kind: "error",
            message: quickAssistantInFlight.value
              ? "Une opération locale a échoué. Votre contenu est conservé. Réessayez après avoir vérifié la connexion ou le stockage local."
              : /réessayez|conservé|brouillon/iu.test(message)
                ? message
                : `${message} Votre brouillon reste affiché ; réessayez ou verrouillez seulement après une sauvegarde réussie.`,
          })
        : null;
  },
);
watch(settingsStatus, (message) => {
  if (message && vault.isUnlocked) notify({ kind: "success", message });
});
watch(settingsError, (message) => {
  if (message && vault.isUnlocked) notify({ kind: "error", message });
});
let deletedListRequest = 0;
const attachmentPreview = ref<{
  contentType: string;
  name: string;
  url: string;
} | null>(null);
const attachmentDialog = ref<HTMLElement>();
// Échap appartient à la pile d'overlays : l'aperçu n'installe pas son propre
// gestionnaire pour ne pas fermer un overlay situé au-dessus de lui.
const attachmentFocus = new DialogFocusController({
  getContainer: () => attachmentDialog.value ?? null,
});
const attachmentOverlay = ref<OverlayHandle>();
watch(attachmentPreview, async (preview) => {
  if (preview) {
    attachmentOverlay.value = pushOverlay({
      label: "attachment-preview",
      lockScroll: true,
      onEscape: () => {
        attachmentPreview.value = null;
      },
    });
    await nextTick();
    if (attachmentPreview.value) attachmentFocus.attach();
    return;
  }
  attachmentOverlay.value?.release();
  attachmentOverlay.value = undefined;
  attachmentFocus.detach();
});
const draftBaseRevision = ref<number | null>(null);
const draftEditBase = ref<NoteEditBase | null>(null);
watch(
  draftBaseRevision,
  (revision) => {
    if (revision === null) draftEditBase.value = null;
  },
  { flush: "sync" },
);
const pendingSaves = reactive(
  new Map<
    string,
    {
      content: string;
      baseRevision: number;
      noteId: string;
      editBase: NoteEditBase;
    }
  >(),
);
const localSaveFailed = ref(false);
let saveInFlight: Promise<boolean> | undefined;

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
    label: noteTitle(note.content, "Nouvelle note"),
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
  // Attachments stay in the encrypted vault for inline images, links, import
  // and export, but the Notes explorer lists only notes.
  return buildVaultTree(sources);
});

const searchResults = computed(() =>
  searchLocalNotes(queryNotes.value, searchQuery.value),
);

const paletteCommands = computed<PaletteCommand[]>(() => [
  ...recentNotes.value.slice(0, 5).map((note) => ({
    category: "Récents",
    hint: note.path,
    id: `recent-note:${note.id}`,
    label: note.label,
  })),
  ...vault.preferences.savedSearches.slice(0, 5).map((search) => ({
    category: "Recherches sauvegardées",
    hint: search.query,
    id: `saved-search:${search.id}`,
    label: search.label,
  })),
  { category: "Créer", id: "new-note", label: "Nouvelle note" },
  {
    category: "Créer",
    id: "quick-assistant",
    label: "Prompt rapide à l’assistant",
    hint: "Ctrl+Alt+K",
  },
  { category: "Créer", id: "new-folder", label: "Nouveau dossier" },
  {
    category: "Créer",
    id: "from-template",
    label: "Créer une note depuis un modèle",
  },
  {
    category: "Importer / exporter",
    id: "import",
    label: "Importer un ZIP ou un dossier Markdown",
  },
  { category: "Importer / exporter", id: "export", label: "Exporter Markdown" },
  { category: "Affichage", id: "settings", label: "Paramètres" },
  { category: "Affichage", id: "theme", label: "Basculer le thème" },
  {
    category: "Affichage",
    id: "toggle-sidebar",
    label: "Afficher ou masquer la barre latérale",
  },
  {
    category: "Affichage",
    id: "toggle-compact",
    label: "Afficher ou masquer les titres de section",
  },
  { category: "Sécurité", id: "lock", label: "Verrouiller le coffre" },
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
    .filter((note): note is QueryNote => Boolean(note)),
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

/** Brouillon de saisie du titre ; null quand le champ reflète le titre réel. */
const noteTitleDraft = ref<string | null>(null);

watch(noteId, () => {
  noteTitleDraft.value = null;
});

function onNoteTitleInput(event: Event) {
  noteTitleDraft.value = (event.target as HTMLInputElement).value;
}

/** Le titre du bandeau est la source du H1 : la saisie réécrit le premier titre
 * du markdown et le persiste, sans jamais changer le chemin de la note. */
async function commitNoteTitle() {
  if (noteTitleDraft.value === null) return;
  const draft = noteTitleDraft.value;
  noteTitleDraft.value = null;
  const next = draft.trim();
  if (!next || next === currentNoteTitle.value) return;
  const lines = content.value.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim().startsWith("# "));
  if (headingIndex >= 0) {
    lines[headingIndex] = `# ${next}`;
  } else {
    lines.unshift(`# ${next}`, "");
  }
  await save(lines.join("\n"));
}

function cancelNoteTitleEdit() {
  noteTitleDraft.value = null;
}

/** Le fil d'Ariane ne garde que les dossiers : le dernier segment du chemin est
 * le nom de fichier, un identifiant interne déjà remplacé par le titre affiché
 * juste en dessous. Une note à la racine n'a donc aucun fil d'Ariane. */
const breadcrumbSegments = computed(() => {
  const path = vault.notes.get(noteId.value)?.path;
  if (!path) return [];
  return path.split("/").filter(Boolean).slice(0, -1);
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
    label: `Snapshot de récupération · révision ${entry.revision}`,
    recordedAt: entry.recordedAt,
    recoverySnapshot: entry.recoverySnapshot,
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
  noteHistoryOpen.value = false;
}

/** Only one side tool (note history OR assistant) may be open. */
function toggleNoteTools(tool: "relations" | "assistant") {
  if (tool === "relations") {
    noteHistoryOpen.value = !noteHistoryOpen.value;
    if (noteHistoryOpen.value) {
      assistantOpen.value = false;
    }
  } else {
    assistantOpen.value = !assistantOpen.value;
    if (assistantOpen.value) {
      noteHistoryOpen.value = false;
      void assistant.refreshModelsIfStale();
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

function openQuickAssistant() {
  if (vault.isUnlocked) {
    quickAssistantOpen.value = true;
    void assistant.refreshModelsIfStale();
  }
}

function closeQuickAssistant() {
  quickAssistantOpen.value = false;
}

function isAnotherModalOpen(): boolean {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"], dialog[open]',
    ),
  ).some((element) => isDialogElementVisible(element));
}

function toggleQuickAssistantFromShortcut(event: KeyboardEvent) {
  if (
    !(event.ctrlKey || event.metaKey) ||
    !event.altKey ||
    event.shiftKey ||
    event.getModifierState("AltGraph") ||
    event.repeat ||
    (event.key.toLowerCase() !== "k" && event.code !== "KeyK")
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  if (quickAssistantInFlight.value) return;
  if (quickAssistantOpen.value) {
    closeQuickAssistant();
    return;
  }
  if (isAnotherModalOpen()) return;
  openQuickAssistant();
}

function quickAssistantBaseSessionIsCurrent(context: {
  accountId: string | null;
  epoch: number;
  vaultId: string | null;
}): boolean {
  return (
    context.epoch === vaultViewEpoch &&
    context.accountId === auth.userId &&
    context.vaultId === vault.currentVaultId &&
    vault.isUnlocked
  );
}

function quickAssistantSessionIsCurrent(context: {
  accountId: string | null;
  editingNoteId: string;
  epoch: number;
  vaultId: string | null;
}): boolean {
  return (
    quickAssistantBaseSessionIsCurrent(context) &&
    context.editingNoteId === noteId.value
  );
}

function quickAssistantNoteIsCurrent(noteId: string | null): boolean {
  return !noteId || vault.notes.has(noteId);
}

function dismissQuickProgress(id: number) {
  if (quickAssistantToastId !== id) return;
  dismissToast(id);
  quickAssistantToastId = null;
}

async function deliverQuickAssistantPrompt(
  prompt: string,
  context: {
    accountId: string | null;
    editingNoteId: string;
    epoch: number;
    noteId: string | null;
    vaultId: string | null;
  },
  pendingToastId: number,
  runId: symbol,
) {
  try {
    const resultNoteId = await assistant.send(prompt);
    if (!quickAssistantBaseSessionIsCurrent(context)) {
      dismissQuickProgress(pendingToastId);
      return;
    }
    if (!quickAssistantNoteIsCurrent(context.noteId)) {
      dismissQuickProgress(pendingToastId);
      quickAssistantToastId = notify({
        kind: "error",
        message:
          "La note liée n’est plus disponible. Aucune réponse n’a été affichée.",
      });
      return;
    }
    dismissQuickProgress(pendingToastId);
    if (resultNoteId) {
      if (noteId.value === context.editingNoteId) {
        await showNote(resultNoteId);
        if (!quickAssistantBaseSessionIsCurrent(context)) return;
      }
      notify({
        kind: "success",
        message: "L’action de l’assistant a été appliquée.",
        ...(noteId.value !== resultNoteId
          ? {
              action: {
                label: "Ouvrir la note",
                run: () => {
                  if (quickAssistantBaseSessionIsCurrent(context))
                    void showNote(resultNoteId);
                },
              },
            }
          : {}),
      });
    } else {
      notify({
        kind: "info",
        message: "La réponse de l’assistant est disponible.",
        action: {
          label: "Voir la réponse",
          run: () => {
            if (quickAssistantBaseSessionIsCurrent(context))
              assistantOpen.value = true;
          },
        },
      });
    }
  } catch {
    if (!quickAssistantBaseSessionIsCurrent(context)) {
      dismissQuickProgress(pendingToastId);
      return;
    }
    if (!quickAssistantNoteIsCurrent(context.noteId)) {
      dismissQuickProgress(pendingToastId);
      quickAssistantToastId = notify({
        kind: "error",
        message:
          "La note liée n’est plus disponible. Aucune réponse n’a été affichée.",
      });
      return;
    }
    dismissQuickProgress(pendingToastId);
    quickAssistantToastId = notify({
      kind: "error",
      message:
        "L’assistant n’a pas pu terminer la demande. Votre contenu local est conservé.",
    });
  } finally {
    if (quickAssistantRunId === runId) {
      quickAssistantRunId = null;
      quickAssistantInFlight.value = false;
    }
  }
}

async function submitQuickAssistantPrompt(payload: {
  model: string;
  prompt: string;
}) {
  const prompt = payload.prompt.trim();
  const model = payload.model.trim();
  if (
    !prompt ||
    !model ||
    !assistant.connected ||
    assistant.busy ||
    quickAssistantInFlight.value ||
    !vault.isUnlocked
  )
    return;
  const runId = Symbol("quick-assistant-run");
  quickAssistantRunId = runId;
  quickAssistantInFlight.value = true;
  let handedToDelivery = false;
  const context = {
    accountId: auth.userId,
    editingNoteId: noteId.value,
    epoch: vaultViewEpoch,
    noteId:
      (selectedNoteId.value && vault.notes.has(noteId.value)) ||
      (!vault.notes.has(noteId.value) && !isNewNoteDraft(content.value))
        ? noteId.value
        : null,
    vaultId: vault.currentVaultId,
  };
  const progressToastId = notify({
    kind: "info",
    message: "L’assistant travaille sur votre demande.",
    pending: true,
  });
  quickAssistantToastId = progressToastId;
  try {
    await assistant.setModel(model);
    if (!quickAssistantSessionIsCurrent(context)) return;
    if (
      context.noteId &&
      (!vault.notes.has(context.noteId) ||
        draftBaseRevision.value !== null ||
        pendingSaves.size > 0 ||
        Boolean(saveInFlight) ||
        vault.notes.get(context.noteId)?.content !== content.value)
    ) {
      if (!(await save(content.value))) {
        if (quickAssistantSessionIsCurrent(context)) {
          dismissToast(quickAssistantToastId!);
          quickAssistantToastId = notify({
            kind: "error",
            message:
              "La note n’a pas pu être enregistrée. Aucune demande n’a été envoyée.",
          });
          quickAssistantOpen.value = true;
        }
        return;
      }
    }
    if (!quickAssistantSessionIsCurrent(context)) return;
    if (!quickAssistantNoteIsCurrent(context.noteId)) {
      dismissQuickProgress(progressToastId);
      quickAssistantToastId = notify({
        kind: "error",
        message:
          "La note liée n’est plus disponible. Aucune demande n’a été envoyée.",
      });
      return;
    }
    await assistant.newConversation(context.noteId ?? undefined);
    if (!quickAssistantSessionIsCurrent(context)) return;
    if (!quickAssistantNoteIsCurrent(context.noteId)) {
      dismissQuickProgress(progressToastId);
      quickAssistantToastId = notify({
        kind: "error",
        message:
          "La note liée n’est plus disponible. Aucune demande n’a été envoyée.",
      });
      return;
    }
    closeQuickAssistant();
    const pendingToastId = quickAssistantToastId;
    if (pendingToastId !== null) {
      handedToDelivery = true;
      void deliverQuickAssistantPrompt(prompt, context, pendingToastId, runId);
    }
  } catch {
    if (quickAssistantSessionIsCurrent(context)) {
      dismissQuickProgress(progressToastId);
      quickAssistantToastId = notify({
        kind: "error",
        message:
          "L’assistant n’a pas pu démarrer. Aucune demande n’a été envoyée.",
      });
    }
    if (quickAssistantRunId === runId) {
      quickAssistantRunId = null;
      quickAssistantInFlight.value = false;
    }
  } finally {
    if (!handedToDelivery) {
      dismissQuickProgress(progressToastId);
      if (quickAssistantRunId === runId) {
        quickAssistantRunId = null;
        quickAssistantInFlight.value = false;
      }
    }
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
  content.value = "";
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
    if (lastDeletionToastId !== null) dismissToast(lastDeletionToastId);
    lastDeletionToastId = notify({
      kind: "success",
      message: `${label} supprimé.`,
      action: {
        label: "Annuler la suppression",
        run: () => restoreDeletedItem(id),
      },
    });
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
    if (lastDeletedItem.value?.id === id) {
      lastDeletedItem.value = null;
      if (lastDeletionToastId !== null) dismissToast(lastDeletionToastId);
      lastDeletionToastId = null;
    }
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
  if (nextContent !== content.value && draftBaseRevision.value === null) {
    draftBaseRevision.value = vault.headRevision;
    draftEditBase.value = vault.captureNoteEditBase(noteId.value);
  }
  content.value = nextContent;
}

const removeDraftNavigationGuard = router.beforeEach(async (_to, from) => {
  if (
    from.path !== "/vault" ||
    (draftBaseRevision.value === null &&
      pendingSaves.size === 0 &&
      !saveInFlight)
  )
    return true;
  // Navigation waits for the existing durable encrypted save; a storage error
  // keeps the editor mounted and the draft available for retry.
  return await save(content.value);
});

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
  // Explicit transition saves supersede the editor's idle timer; it must not
  // enqueue the same draft again after the transition has begun.
  editorSurface.value?.cancelSave?.();
  if (!vault.notes.has(noteId.value) && isNewNoteDraft(nextContent)) {
    return true;
  }
  content.value = nextContent;
  pendingSaves.set(noteId.value, {
    content: nextContent,
    noteId: noteId.value,
    baseRevision: draftBaseRevision.value ?? vault.headRevision,
    editBase: draftEditBase.value ?? vault.captureNoteEditBase(noteId.value),
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
          editBase: currentSave.editBase,
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
  void assistant.refreshModelsIfStale();
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
  if (id.startsWith("recent-note:")) {
    const selected = id.slice("recent-note:".length);
    if (vault.notes.has(selected)) void selectNote(selected);
  } else if (id.startsWith("saved-search:")) {
    const selected = vault.preferences.savedSearches.find(
      (search) => search.id === id.slice("saved-search:".length),
    );
    if (selected) void openLocalSearch(selected.query);
  } else if (id === "new-note") {
    startNewNote();
  } else if (id === "quick-assistant") {
    openQuickAssistant();
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
  searchPaletteOpen.value = true;
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

/** L'épingle se pilote depuis l'arbre : seules les vraies notes (pas les
 * pièces jointes) peuvent l'être. */
async function toggleTreePin(id: string) {
  if (vault.notes.has(id)) {
    await vault.togglePinnedNote(id);
  }
}

const noteMenuOpen = ref(false);
const noteMenuX = ref(0);
const noteMenuY = ref(0);
const noteMenuNoteId = ref<string>();

/** Le clic droit n'ouvre le menu que pour une vraie note (pas un dossier ni
 * une pièce jointe) et ne déplace JAMAIS la sélection. */
function openNoteMenu(payload: { id: string; x: number; y: number }) {
  if (!vault.notes.has(payload.id)) {
    return;
  }
  noteMenuNoteId.value = payload.id;
  noteMenuX.value = payload.x;
  noteMenuY.value = payload.y;
  noteMenuOpen.value = true;
}

function closeNoteMenu() {
  noteMenuOpen.value = false;
}

const noteMenuItems = computed<MarkdownMenuItem[]>(() => {
  const id = noteMenuNoteId.value;
  if (!id || !vault.notes.has(id)) {
    return [];
  }
  const pinned = vault.preferences.pinnedNoteIds.includes(id);
  return [
    {
      type: "item",
      id: "pin",
      label: pinned ? "Désépingler" : "Épingler",
      checked: pinned,
    },
    { type: "separator" },
    { type: "item", id: "export-pdf", label: "Exporter en PDF" },
    { type: "item", id: "export-markdown", label: "Exporter en Markdown" },
    { type: "item", id: "copy-link", label: "Copier le lien de la note" },
    { type: "item", id: "copy-wikilink", label: "Copier le wikilink" },
    { type: "item", id: "duplicate", label: "Dupliquer la note" },
    { type: "item", id: "history", label: "Historique local" },
    { type: "separator" },
    { type: "item", id: "delete", label: "Supprimer", destructive: true },
  ];
});

function noteLabel(id: string): string {
  return queryNotes.value.find((note) => note.id === id)?.label ?? "Note";
}

/** Téléchargement local d'un PDF produit en mémoire : le contenu ne quitte
 * jamais le client (condition E2EE) et aucune boîte d'impression ne s'ouvre. */
function exportNotePdf(id: string) {
  const note = vault.notes.get(id);
  if (!note) return;
  const label = noteLabel(id);
  downloadNotePdf({
    filename: markdownExportFilename(label, []).replace(/\.md$/iu, ".pdf"),
    markdown: note.content,
    title: label,
  });
}

/** Téléchargement Markdown : Blob local + lien de téléchargement, sans réseau. */
function downloadNoteMarkdown(id: string) {
  const note = vault.notes.get(id);
  if (!note) return;
  const blob = new Blob([note.content], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  // L'assainisseur existant du ZIP garantit un nom de fichier sûr.
  link.download = markdownExportFilename(noteLabel(id), []);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Adresse d'application qui ouvre cette note : le routeur construit le
 * chemin et seul l'identifiant opaque de la note (uuidV7) est copié — jamais
 * le titre ni le contenu. Le presse-papiers reste local au navigateur : aucune
 * donnée de coffre ne part vers le serveur (invariant E2EE). */
async function copyNoteUrl(id: string) {
  if (!vault.notes.has(id)) return;
  const href = router.resolve({ path: "/vault", query: { note: id } }).href;
  try {
    await navigator.clipboard.writeText(`${window.location.origin}${href}`);
  } catch {
    formError.value = "Copie impossible : le presse-papiers est indisponible.";
  }
}

/** Wikilink tel que l'éditeur l'insère lui-même : [[chemin-sans-.md]]
 * (wikilinkTarget de MarkdownEditor) et resolveWikilink retrouve la note
 * depuis ce même chemin, pour écrire un lien à l'intérieur d'une note. */
async function copyNoteWikilink(id: string) {
  const note = vault.notes.get(id);
  if (!note) return;
  const path = fullNotePath(note.path, id);
  const target = path.replace(/\.md$/iu, "");
  try {
    await navigator.clipboard.writeText(`[[${target}]]`);
  } catch {
    formError.value = "Copie impossible : le presse-papiers est indisponible.";
  }
}

async function duplicateNote(id: string) {
  const note = vault.notes.get(id);
  if (!note) return;
  const path = fullNotePath(note.path, id);
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash + 1) : "";
  const stem = path.slice(slash + 1).replace(/\.md$/iu, "") || "note";
  await vault.saveNote({
    content: note.content,
    id: uuidV7(),
    path: `${folder}${stem} (copie).md`,
  });
}

/** Réutilise le mécanisme existant de l'historique local (noteHistoryOpen /
 * assistantOpen / toggleNoteTools) ; la note visée devient la note courante
 * car l'historique affiché est celui du volet relations. */
async function openNoteHistory(id: string) {
  if (id !== noteId.value) {
    await showNote(id);
  }
  if (!noteHistoryOpen.value) {
    toggleNoteTools("relations");
  }
}

async function onNoteMenuSelect(action: string) {
  const id = noteMenuNoteId.value;
  closeNoteMenu();
  if (!id || !vault.notes.has(id)) return;
  if (action === "pin") {
    await toggleTreePin(id);
  } else if (action === "export-pdf") {
    exportNotePdf(id);
  } else if (action === "export-markdown") {
    downloadNoteMarkdown(id);
  } else if (action === "copy-link") {
    await copyNoteUrl(id);
  } else if (action === "copy-wikilink") {
    await copyNoteWikilink(id);
  } else if (action === "duplicate") {
    await duplicateNote(id);
  } else if (action === "history") {
    await openNoteHistory(id);
  } else if (action === "delete") {
    await deleteNote(id);
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

function checkAssistantCatalog() {
  void assistant.refreshModelsIfStale();
}
let catalogRefreshTimer: number | undefined;

onMounted(() => {
  window.addEventListener("online", onOnline);
  window.addEventListener("focus", checkAssistantCatalog);
  catalogRefreshTimer = window.setInterval(
    checkAssistantCatalog,
    60 * 60 * 1000,
  );
  window.addEventListener("keydown", toggleQuickAssistantFromShortcut, true);
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

/** Valeur de ?note= (lien copié par « Copier le lien de la note »). */
function deepLinkValue(): string {
  const value = route.query.note;
  return typeof value === "string" ? value.trim() : "";
}

/** Note visée par le lien : identifiant exact, sinon chemin de note (avec ou
 * sans .md, sans tenir compte de la casse). */
function deepLinkedNoteId(value: string): string | undefined {
  if (vault.notes.has(value)) return value;
  const target = value.toLowerCase().replace(/\.md$/u, "");
  return queryNotes.value.find(
    (note) => note.path.toLowerCase().replace(/\.md$/u, "") === target,
  )?.id;
}

/** Valeur distincte déjà traitée : chaque lien n'ouvre la note qu'une fois,
 * sans boucler quand les notes arrivent ensuite. */
const handledDeepLink = ref("");
/** Note ouverte par le lien profond : elle prime sur la note la plus récente. */
let deepLinkTarget: string | undefined;

async function openDeepLinkedNote() {
  const requested = deepLinkValue();
  if (!requested || !vault.isUnlocked) return;
  if (handledDeepLink.value === requested) return;
  const id = deepLinkedNoteId(requested);
  if (id) {
    handledDeepLink.value = requested;
    deepLinkTarget = id;
    await showNote(id);
    return;
  }
  // Les notes arrivent après le déverrouillage : tant que le coffre n'en
  // contient aucune, le lien n'est pas jugé introuvable et reste en attente.
  if (vault.notes.size === 0) return;
  handledDeepLink.value = requested;
  notify({
    kind: "warning",
    message:
      "Note introuvable : le lien ne correspond à aucune note du coffre.",
  });
}

watch(
  [() => route.query.note, () => vault.isUnlocked, () => vault.notes.size],
  () => void openDeepLinkedNote(),
  { immediate: true },
);

/** Reopens the most recent note that still exists, from the encrypted vault
 * preferences (recentNoteIds), never from plaintext localStorage. */
async function reopenMostRecentNote() {
  if (!vault.isUnlocked || vault.notes.has(noteId.value)) return;
  // Un lien profond résolu (?note=) a déjà choisi la note affichée.
  if (deepLinkTarget) return;
  if (vault.preferences.recentNoteIds.length === 0) return;
  const mostRecent = vault.preferences.recentNoteIds.find((id) =>
    vault.notes.has(id),
  );
  if (mostRecent) await selectNote(mostRecent, false);
}

onUnmounted(() => {
  clearToasts();
  attachmentOverlay.value?.release();
  attachmentOverlay.value = undefined;
  attachmentFocus.detach();
  vaultViewEpoch++;
  closeDeletedItems();
  window.removeEventListener("online", onOnline);
  window.removeEventListener("focus", checkAssistantCatalog);
  window.clearInterval(catalogRefreshTimer);
  window.removeEventListener("keydown", toggleQuickAssistantFromShortcut, true);
  removeDraftNavigationGuard();
  for (const url of Object.values(blobUrls.value)) {
    URL.revokeObjectURL(url);
  }
});

watch(
  [() => vault.isUnlocked, () => vault.currentVaultId, () => auth.userId],
  () => {
    quickAssistantOpen.value = false;
    vaultViewEpoch++;
    quickAssistantToastId = null;
    quickAssistantRunId = null;
    quickAssistantInFlight.value = false;
    clearToasts();
    errorToastId = null;
    lastDeletionToastId = null;
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
  () => [...vault.attachments.values()],
  () => refreshBlobUrls(),
  { immediate: true },
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
    :tool-open="assistantOpen || noteHistoryOpen"
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
      <VaultNotesSectionHeader
        :compact="sidebar.compact.value"
        :collapsed="sidebar.collapsed.value"
        @new-note="startNewNote()"
      />
      <VaultTree
        v-if="!sidebar.collapsed.value"
        :attached-ids="assistant.attachedNoteIds"
        :nodes="treeNodes"
        :pinned-ids="vault.preferences.pinnedNoteIds"
        :selected-id="treeSelectedId"
        @attach="attachNote"
        @delete="deleteNote"
        @menu="openNoteMenu"
        @pin="toggleTreePin"
        @select="selectNote"
      />
      <div class="sidebar-footer">
        <button
          class="deleted-items-trigger"
          type="button"
          aria-label="Éléments supprimés"
          v-synapse-tooltip="'Éléments supprimés'"
          @click="openDeletedItems"
        >
          <span class="footer-item-icon" aria-hidden="true"
            ><svg viewBox="0 0 24 24" width="18" height="18">
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"
              /></svg></span
          ><span class="footer-item-label">Éléments supprimés</span>
        </button>
        <button
          class="settings-button"
          type="button"
          aria-haspopup="dialog"
          :aria-expanded="settingsOpen"
          aria-label="Ouvrir les paramètres"
          v-synapse-tooltip="'Ouvrir les paramètres'"
          @click="settingsOpen = true"
        >
          <span class="footer-item-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path
                fill="currentColor"
                d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.6.24-1.15.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64L4.86 10.7c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.16a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.64.22l2.39-.96c.48.39 1.03.7 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.6-.24 1.15-.55 1.63-.94l2.39.96c.24.1.51.01.64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
              />
            </svg>
          </span>
          <span class="settings-label footer-item-label">Paramètres</span>
        </button>
        <button
          class="logout-button"
          type="button"
          aria-label="Se déconnecter"
          v-synapse-tooltip="'Se déconnecter'"
          @click="logout"
        >
          <span class="footer-item-icon" aria-hidden="true"
            ><svg viewBox="0 0 24 24" width="18" height="18">
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
              /></svg></span
          ><span class="logout-label footer-item-label">Se déconnecter</span>
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
          <input
            class="note-title-input"
            type="text"
            :value="noteTitleDraft ?? currentNoteTitle"
            aria-label="Titre de la note"
            @input="onNoteTitleInput"
            @change="commitNoteTitle"
            @blur="commitNoteTitle"
            @keydown.enter.prevent="commitNoteTitle"
            @keydown.esc.prevent="cancelNoteTitleEdit"
          />
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
            :aria-pressed="assistantOpen"
            @click="toggleNoteTools('assistant')"
          >
            Assistant
          </button>
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
      <section
        v-else-if="importPlan"
        class="import-preview import-preview-card"
        aria-labelledby="import-preview-title"
      >
        <header class="import-preview-header">
          <div>
            <span class="import-preview-eyebrow">Import Markdown</span>
            <h2 id="import-preview-title">Prévisualisation de l’import</h2>
          </div>
          <p v-if="importProgress" role="status" class="import-progress">
            {{ importProgress.completed }} / {{ importProgress.total }} chiffrés
          </p>
        </header>
        <div class="import-preview-summary" aria-label="Résumé de l’import">
          <article>
            <strong>{{ importPlan.notes.length }}</strong>
            <span>{{ importPlan.notes.length > 1 ? "notes" : "note" }}</span>
          </article>
          <article>
            <strong>{{ importPlan.attachments.length }}</strong>
            <span>{{
              importPlan.attachments.length > 1
                ? "pièces jointes"
                : "pièce jointe"
            }}</span>
          </article>
          <article v-if="importPlan.ignored.length">
            <strong>{{ importPlan.ignored.length }}</strong>
            <span>ignoré{{ importPlan.ignored.length > 1 ? "s" : "" }}</span>
          </article>
          <article v-if="importCollisions.length" class="import-warning">
            <strong>{{ importCollisions.length }}</strong>
            <span
              >remplacement{{ importCollisions.length > 1 ? "s" : "" }}</span
            >
          </article>
        </div>
        <p class="import-preview-copy">
          Les éléments retenus seront chiffrés localement avant d’entrer dans le
          coffre. Les chemins ignorés restent listés pour vérification.
        </p>
        <details class="import-preview-details">
          <summary>Détails de l’import</summary>
          <ul>
            <li
              v-for="note in importPlan.notes.slice(0, 20)"
              :key="`note-${note.path}`"
            >
              <span>Note</span><code>{{ note.path }}</code>
            </li>
            <li
              v-for="attachment in importPlan.attachments.slice(0, 20)"
              :key="`attachment-${attachment.path}`"
            >
              <span>Pièce jointe</span><code>{{ attachment.path }}</code>
            </li>
            <li
              v-for="ignored in importPlan.ignored.slice(0, 20)"
              :key="`ignored-${ignored.path}`"
            >
              <span>Ignoré</span><code>{{ ignored.path }}</code>
              <small>{{ ignored.reason }}</small>
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
            :hide-first-heading="true"
            @update:model-value="updateDraft"
            :attachment-urls="blobUrls"
            :wikilink-suggestions="wikilinkSuggestions"
            @attach-files="attachFiles"
            @open-wikilink="openWikilink"
            @save="save"
          />
        </div>
      </template>
      <div v-if="searchQuery && !searchPaletteOpen" class="saved-search-action">
        <Button
          label="Enregistrer la recherche"
          outlined
          type="button"
          @click="saveSearch"
        />
      </div>
    </section>
    <template #relations v-if="noteHistoryOpen">
      <div class="note-history-slot">
        <header class="note-history-header">
          <span>Historique local</span>
          <button
            aria-label="Fermer l'historique local"
            name="close-note-history"
            type="button"
            @click="noteHistoryOpen = false"
          >
            ×
          </button>
        </header>
        <HistoryPanel
          recovery-view
          :entries="historyEntries"
          :restore-points="restorePoints"
          @restore="restoreHistory"
        />
      </div>
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
    :error-message="''"
    :offline="auth.isOfflineSession || auth.isLocalMode"
    :open="settingsOpen"
    :sessions="sessions"
    :users="users"
    :invitation-link="invitationLink"
    :status-message="''"
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
    @close="searchPaletteOpen = false"
    @open="searchPaletteOpen = true"
    @run="runCommand"
    @select="selectNote"
    @update:query="searchQuery = $event"
  />
  <QuickAssistantPrompt
    :active-note="
      Boolean(
        (selectedNoteId && vault.notes.has(selectedNoteId)) ||
          (!vault.notes.has(noteId) && !isNewNoteDraft(content)),
      )
    "
    :busy="assistant.busy || quickAssistantInFlight"
    :connected="assistant.connected"
    :model="assistant.model"
    :models="assistant.models"
    :open="quickAssistantOpen"
    @close="closeQuickAssistant"
    @submit="submitQuickAssistantPrompt"
  />
  <VaultContextMenu
    :items="noteMenuItems"
    :open="noteMenuOpen"
    :x="noteMenuX"
    :y="noteMenuY"
    @close="closeNoteMenu"
    @select="onNoteMenuSelect"
  />
  <div
    v-if="attachmentPreview"
    class="attachment-preview-backdrop"
    role="presentation"
    :style="{ zIndex: attachmentOverlay?.zIndex }"
    @click.self="attachmentPreview = null"
  >
    <section
      ref="attachmentDialog"
      class="attachment-preview"
      role="dialog"
      aria-modal="true"
      :aria-label="`Aperçu ${attachmentPreview.name}`"
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
.vault-page {
  min-height: 100vh;
}

/* Bureau : la page ne défile jamais. Chaque zone défile en interne (la note
   dans .editor-surface, la liste des notes dans la barre latérale) et la
   grille .app-shell est bornée à la hauteur de la fenêtre. En dessous, la
   vue redevient fluide (le tiroir mobile et la mise en page ≤860px
   reposent sur le défilement de la page). */
@media (min-width: 861px) {
  .vault-page {
    height: 100vh;
    height: 100dvh;
    grid-template-rows: minmax(0, 1fr);
    overflow: hidden;
  }
}

.attachment-preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--synapse-z-overlay);
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
  min-height: 0;
  padding: 1.35rem 1rem;
  background: color-mix(
    in srgb,
    var(--synapse-color-surface-raised) 65%,
    var(--synapse-color-surface)
  );
  backdrop-filter: blur(6px);
}

/* Seule la liste des notes défile dans la barre latérale : l'en-tête, les
   filtres et le pied (paramètres, déconnexion) restent visibles. La liste est
   un enfant direct de l'aside (pas du conteneur de grille) : le sélecteur doit
   donc descendre dans la barre latérale. */
.vault-page :deep(.app-shell-sidebar > .vault-tree) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
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

.vault-page.app-shell--sidebar-collapsed .deleted-items-trigger {
  flex: 0 0 2rem;
  justify-content: center;
  width: 2rem;
  min-height: 2rem;
  padding: 0;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  background: var(--synapse-color-surface-raised);
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
  min-height: 0;
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

/* Le titre du bandeau est éditable : il hérite de l'apparence du h2 qu'il
   remplace et ne révèle sa bordure qu'au survol et à la focalisation. */
.note-title-input {
  margin: 0.2rem 0 0;
  min-width: 0;
  padding: 0 0.2rem;
  border: 1px solid transparent;
  border-radius: var(--synapse-radius-sm);
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: clamp(1.4rem, 2.5vw, 2rem);
  font-weight: 700;
  letter-spacing: -0.04em;
}

.note-title-input:hover {
  border-color: var(--synapse-color-border);
}

.note-title-input:focus {
  border-color: var(--synapse-color-accent);
  outline: none;
}

/* Panneau d'historique local, dans le slot latéral de l'interpréteur. */
.note-history-slot {
  display: grid;
  gap: 0.85rem;
}

.note-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  color: var(--synapse-color-text-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.note-history-header button {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: var(--synapse-color-surface-raised);
  font: inherit;
  font-size: 1.15rem;
  line-height: 1;
  cursor: pointer;
}

.note-history-header button:hover {
  border-color: var(--synapse-color-accent);
  color: var(--synapse-color-text);
}

.note-history-header button:focus-visible {
  outline: 2px solid var(--synapse-color-accent);
  outline-offset: 1px;
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

.sync-pill[data-status="conflict"] {
  color: var(--synapse-color-danger);
  background: color-mix(in srgb, var(--synapse-color-danger) 12%, transparent);
}

.sync-pill[data-status="error"] {
  color: var(--synapse-color-warning);
  background: color-mix(in srgb, var(--synapse-color-warning) 10%, transparent);
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
  flex-direction: column;
  align-items: stretch;
  flex: 0 0 auto;
  gap: 0.15rem;
  margin-top: auto;
  padding-top: 0.9rem;
  border-top: 1px solid var(--synapse-color-border);
}

.deleted-items-trigger,
.settings-button,
.logout-button {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex: 0 0 auto;
  width: 100%;
  min-width: 0;
  padding: 0.6rem 0.7rem;
  white-space: nowrap;
  border: 0;
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: transparent;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  text-align: start;
  transition:
    color 140ms ease,
    background 140ms ease;
}

.footer-item-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 1.15rem;
  height: 1.15rem;
}

.footer-item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deleted-items-trigger:hover,
.deleted-items-trigger:focus-visible,
.settings-button:hover,
.settings-button:focus-visible {
  color: var(--synapse-color-text);
  background: color-mix(
    in srgb,
    var(--synapse-color-border) 40%,
    var(--synapse-color-surface-muted)
  );
}

.deleted-items-trigger:focus-visible,
.settings-button:focus-visible,
.logout-button:focus-visible {
  outline: 2px solid
    color-mix(in srgb, var(--synapse-color-accent) 55%, transparent);
  outline-offset: 1px;
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
  min-height: 60vh;
}

.import-preview-card {
  align-self: start;
  justify-self: center;
  display: grid;
  gap: 1.1rem;
  width: min(58rem, calc(100% - clamp(2rem, 6vw, 4rem)));
  margin: clamp(1.25rem, 4vh, 2.5rem) 0;
  padding: clamp(1rem, 3vw, 1.5rem);
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-md);
  background: var(--synapse-color-surface-raised);
  box-shadow: var(--synapse-shadow-sm);
}

.import-preview-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
}

.import-preview-eyebrow {
  color: var(--synapse-color-text-muted);
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.import-preview h2 {
  margin: 0.25rem 0 0;
  font-size: clamp(1.3rem, 2.2vw, 1.65rem);
  letter-spacing: -0.03em;
}

.import-preview-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 0.75rem;
}

.import-preview-summary article {
  display: grid;
  gap: 0.15rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  background: color-mix(
    in srgb,
    var(--synapse-color-surface-muted) 45%,
    transparent
  );
}

.import-preview-summary strong {
  font-size: 1.6rem;
  line-height: 1;
}

.import-preview-summary span,
.import-preview-copy,
.import-preview-details small,
.import-progress {
  color: var(--synapse-color-text-muted);
}

.import-warning {
  border-color: color-mix(
    in srgb,
    var(--synapse-color-warning) 35%,
    var(--synapse-color-border)
  ) !important;
  color: var(--synapse-color-warning);
  background: color-mix(
    in srgb,
    var(--synapse-color-warning) 10%,
    transparent
  ) !important;
}

.import-preview-copy {
  margin: 0;
  line-height: 1.55;
}

.import-preview-details {
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  background: var(--synapse-color-surface);
}

.import-preview-details summary {
  padding: 0.8rem 1rem;
  cursor: pointer;
  font-weight: 700;
}

.import-preview-details ul {
  display: grid;
  gap: 0.35rem;
  max-height: 15rem;
  margin: 0;
  padding: 0 1rem 1rem;
  overflow: auto;
  list-style: none;
}

.import-preview-details li {
  display: grid;
  grid-template-columns: minmax(5.5rem, auto) minmax(0, 1fr);
  gap: 0.35rem 0.75rem;
  align-items: baseline;
  padding: 0.45rem 0;
  border-top: 1px solid var(--synapse-color-border);
}

.import-preview-details code {
  overflow-wrap: anywhere;
  font-family: var(--synapse-font-mono);
}

.import-preview-details small {
  grid-column: 2;
}

.import-preview-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.75rem;
}

@media (max-width: 48rem) {
  .import-preview-card {
    width: calc(100% - 1.5rem);
    margin-block: 0.75rem;
  }

  .import-preview-header {
    display: grid;
  }

  .import-preview-actions {
    justify-content: stretch;
  }

  .import-preview-actions :deep(button) {
    flex: 1 1 10rem;
  }
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
.save-status[data-state="conflict"] {
  color: var(--synapse-color-danger);
}

.save-status[data-state="sync-error"] {
  color: var(--synapse-color-warning);
}

.save-status[data-state="error"]::before,
.save-status[data-state="conflict"]::before {
  background: var(--synapse-color-danger);
}

.save-status[data-state="sync-error"]::before {
  background: var(--synapse-color-warning);
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
