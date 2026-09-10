<script setup lang="ts">
import LocalFolderPanel from "./LocalFolderPanel.vue";
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
  type QueryNote,
  type SettingsSession,
  type VaultTreeNode,
} from "@synapse/ui";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import Button from "primevue/button";

import { isTrustedDeviceSupported } from "../crypto/trusted-device";
import { uuidV7 } from "../crypto/vault-key";
import { buildMarkdownZip } from "../export/markdown-zip";
import { applyMarkdownImport, type ImportProgress } from "../import/apply";
import {
  planMarkdownImport,
  planZipImport,
  type MarkdownImportPlan,
} from "../import/markdown-folder";
import { useAssistantStore } from "../stores/assistant";
import { useAuthStore } from "../stores/auth";
import { useVaultStore } from "../stores/vault";

const vault = useVaultStore();
const auth = useAuthStore();
const assistant = useAssistantStore();
const router = useRouter();
const content = ref("# Nouvelle note\n\n");
const noteId = ref<string>(uuidV7());
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
const importInput = ref<HTMLInputElement>();
const importFolderInput = ref<HTMLInputElement>();
const importPlan = ref<MarkdownImportPlan | null>(null);
const importProgress = ref<ImportProgress | null>(null);
const importCancelled = ref(false);
const attachmentPreview = ref<{
  contentType: string;
  name: string;
  url: string;
} | null>(null);
const draftBaseRevision = ref<number | null>(null);
const pendingSaves = new Map<
  string,
  { content: string; baseRevision: number; noteId: string }
>();
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

function rootNotePath(path: string | undefined, id: string): string {
  return path?.split("/").filter(Boolean).pop() ?? `${id.slice(0, 8)}.md`;
}

const queryNotes = computed<QueryNote[]>(() =>
  Array.from(vault.notes.entries()).map(([id, note]) => ({
    content: note.content,
    id,
    label: noteTitle(note.content, id.slice(0, 8)),
    path: rootNotePath(note.path, id),
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
  { id: "import", label: "Importer un dossier ou ZIP Markdown" },
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

const currentQueryNote = computed(() =>
  queryNotes.value.find((note) => note.id === noteId.value),
);

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

async function selectNote(id: string) {
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

async function showNote(id: string) {
  if (draftBaseRevision.value !== null && !(await save(content.value))) return;
  draftBaseRevision.value = null;
  selectedNoteId.value = id;
  noteId.value = id;
  content.value = vault.notes.get(id)?.content ?? "";
}

async function startNewNote(folder?: string) {
  if (draftBaseRevision.value !== null && !(await save(content.value))) return;
  draftBaseRevision.value = null;
  noteId.value = uuidV7();
  selectedNoteId.value = null;
  content.value = "# Nouvelle note\n\n";
  formError.value = "";
  if (folder) {
    void vault.saveNote({
      content: content.value,
      id: noteId.value,
      path: `${folder.replace(/\/$/u, "")}/nouvelle.md`,
    });
    selectedNoteId.value = noteId.value;
  }
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
  pendingSaves.delete(id);
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
    graphOpen.value = true;
  } else if (id === "import") {
    requestImport();
  } else if (id === "toggle-sidebar") {
    sidebar.toggleCollapsed();
  } else if (id === "toggle-compact") {
    sidebar.toggleCompact();
  }
}

function openLocalSearch(query: string) {
  void searchPalette.value?.openPalette(query);
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
    rootNotePath(vault.notes.get(noteId.value)?.path, "nouvelle"),
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
    draftBaseRevision.value = null;
    pendingSaves.clear();
    content.value = "";
    assistant.lockSession();
  },
);

watch(
  () => [...vault.attachments.values()].map((file) => file.path).join("|"),
  () => refreshBlobUrls(),
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
            <h1>Coffre</h1>
          </div>
          <span class="sync-pill" :data-status="vault.syncStatus" role="status">
            <span class="sync-dot" aria-hidden="true" />
            {{ vault.syncStatus }}
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
        <div>
          <span v-if="!sidebar.compact.value" class="eyebrow"
            >ÉDITION MARKDOWN</span
          >
        </div>
        <div class="workspace-meta">
          <span v-if="auth.isOfflineSession" class="offline-label"
            >Session hors ligne</span
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
          <Button
            :label="
              vault.preferences.pinnedNoteIds.includes(noteId)
                ? 'Désépingler'
                : 'Épingler'
            "
            outlined
            type="button"
            @click="toggleCurrentPin"
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
        <div class="editor-surface">
          <MarkdownEditor
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
        :restore-points="restorePoints"
        @close="noteHistoryOpen = false"
        @create-restore-point="createRestorePoint"
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
  <LocalFolderPanel />
  <SettingsPanel
    :account-email="accountEmail"
    :device-supported="deviceSupported"
    :device-trusted="deviceTrusted"
    :error-message="settingsError"
    :offline="auth.isOfflineSession || auth.isLocalMode"
    :open="settingsOpen"
    :sessions="sessions"
    :status-message="settingsStatus"
    :templates-path="vault.preferences.templatesPath"
    @change-passphrase="changePassphrase"
    @change-password="changePassword"
    @close="settingsOpen = false"
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
