export { default as AiChat } from "./components/AiChat.vue";
export { default as AiConversationPanel } from "./components/AiConversationPanel.vue";
export { default as AppShell } from "./components/AppShell.vue";
export { DialogFocusController } from "./dialog-focus";
export { default as BacklinksPanel } from "./components/BacklinksPanel.vue";
export { default as ConflictResolver } from "./components/ConflictResolver.vue";
export { default as HistoryPanel } from "./components/HistoryPanel.vue";
export { default as GraphPanel } from "./components/GraphPanel.vue";
export { default as MarkdownEditor } from "./components/MarkdownEditor.vue";
export { default as MarkdownContextMenu } from "./components/MarkdownContextMenu.vue";
export { default as MarkdownPreview } from "./components/MarkdownPreview.vue";
export { default as NoteRelationsPanel } from "./components/NoteRelationsPanel.vue";
export { default as SearchPalette } from "./components/SearchPalette.vue";
export { default as SettingsPanel } from "./components/SettingsPanel.vue";
export { default as ThemeToggle } from "./components/ThemeToggle.vue";
export { default as VaultExplorerToolbar } from "./components/VaultExplorerToolbar.vue";
export { default as VaultNotesSectionHeader } from "./components/VaultNotesSectionHeader.vue";
export { default as IconActionButton } from "./components/IconActionButton.vue";
export { default as VaultTree } from "./components/VaultTree.vue";
export { default as UpdateBanner } from "./components/UpdateBanner.vue";
export {
  createUpdateCoordinator,
  startUpdateChecks,
} from "./update/coordinator";
export type {
  UpdateCoordinator,
  UpdateMetadata,
  UpdateProvider,
  UpdateSnapshot,
  UpdateState,
} from "./update/coordinator";
export type {
  AiChatAttachment,
  AiChatMessage,
  AiChatModelOption,
  AiChatReasoningLevel,
} from "./components/AiChat.vue";
export type { AiConversationPanelItem } from "./components/AiConversationPanel.vue";
export type { Backlink } from "./components/BacklinksPanel.vue";
export type { HistoryPanelEntry } from "./components/HistoryPanel.vue";
export type { HistoryRestorePoint } from "./components/HistoryPanel.vue";
export type {
  PaletteCommand,
  SearchResult,
} from "./components/SearchPalette.vue";
export { parseNote } from "./markdown/parse";
export { readableLineDiff } from "./markdown/diff";
export type { LineDiff } from "./markdown/diff";
export type { ParsedNote } from "./markdown/parse";
export {
  backlinksFor,
  buildLocalGraph,
  noteStem,
  outlineFor,
  resolveWikilink,
  sanitizeAttachmentFileName,
  searchLocalNotes,
  uniqueTags,
  wikilinkPath,
} from "./vault/query";
export type { LocalGraph, OutlineEntry, QueryNote } from "./vault/query";
export { noteUpdatedAt, uuidV7Timestamp } from "./vault/note-date";
export { buildVaultTree } from "./vault/tree";
export { isNewNoteDraft, NEW_NOTE_DRAFT } from "./vault/draft";
export type { TreeSource } from "./vault/tree";
export { renderTemplate } from "./vault/templates";
export type { TemplateContext } from "./vault/templates";
export type {
  SettingsSession,
  SettingsUser,
} from "./components/SettingsPanel.vue";
export type { VaultTreeNode } from "./components/VaultTree.vue";
export { installSynapseUi } from "./plugin";
export { initializeTheme, resetThemeState, useTheme } from "./theme";
export type { ThemeMode, ThemePreference } from "./theme";
export {
  initializeSidebarLayout,
  resetSidebarLayoutState,
  useSidebarLayout,
} from "./sidebar-layout";
export {
  EDITOR_MODE_STORAGE_KEY,
  initializeEditorMode,
  resetEditorModeState,
  useEditorMode,
} from "./editor-mode";
export type { EditorViewMode } from "./editor-mode";
export {
  PANEL_ASIDE_IDS,
  PANEL_CSS_VARS,
  PANEL_RESIZE_LABELS,
  PANEL_WIDTH_BOUNDS,
  PANEL_WIDTH_STORAGE_KEY,
  clampPanelWidth,
  initializePanelLayout,
  resetPanelLayoutState,
  usePanelLayout,
  widthFromPointerDelta,
} from "./panel-resize";
export type { PanelId, ResizeEdge } from "./panel-resize";
export {
  COMPACT_ASSISTANT_MEDIA_QUERY,
  defaultAssistantSidePanelsOpen,
  readCompactAssistantViewport,
  resetCompactAssistantLayoutState,
  useCompactAssistantLayout,
} from "./app-shell-layout";
import "./styles/tokens.css";
