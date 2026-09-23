<script setup lang="ts">
import Vditor from "vditor";
import "vditor/dist/index.css";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useEditorMode } from "../editor-mode";
import {
  emojiForCommand,
  LINK_TOOLBAR_HOTKEY,
  markdownContextMenuItems,
} from "../markdown/editor-tools";
import { useTheme } from "../theme";
import MarkdownContextMenu from "./MarkdownContextMenu.vue";

const props = withDefaults(
  defineProps<{
    attachmentUrls?: Record<string, string>;
    modelValue: string;
    wikilinkSuggestions?: readonly { label: string; path: string }[];
  }>(),
  {
    attachmentUrls: () => ({}),
    wikilinkSuggestions: () => [],
  },
);

const emit = defineEmits<{
  "attach-files": [files: File[]];
  "open-wikilink": [target: string];
  "update:modelValue": [value: string];
  save: [value: string];
}>();

type TableAction =
  | "row-add"
  | "row-add-above"
  | "row-delete"
  | "column-add"
  | "column-add-before"
  | "column-delete";

const TABLE_ACTION_SHORTCUTS: Readonly<
  Record<TableAction, Pick<KeyboardEventInit, "key" | "ctrlKey" | "shiftKey">>
> = {
  "row-add": { key: "=", ctrlKey: true, shiftKey: false },
  "row-add-above": { key: "f", ctrlKey: true, shiftKey: true },
  "row-delete": { key: "-", ctrlKey: true, shiftKey: false },
  // Vditor compares the shifted character on Windows and Linux.
  "column-add": { key: "+", ctrlKey: true, shiftKey: true },
  "column-add-before": { key: "g", ctrlKey: true, shiftKey: true },
  "column-delete": { key: "_", ctrlKey: true, shiftKey: true },
};

const editorRoot = ref<HTMLElement>();
const { mode: themeMode } = useTheme();
const { mode: viewMode, setMode: persistViewMode } = useEditorMode();

const contextMenuOpen = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuInTable = ref(false);
const contextMenuHeadingLevel = ref(0);
const contextMenuSelectionEmpty = ref(false);
const clipboardStatus = ref("");
let contextMenuRange: Range | undefined;

const contextMenuItems = computed(() =>
  markdownContextMenuItems({
    headingLevel: contextMenuHeadingLevel.value,
    inTable: contextMenuInTable.value,
    selectionEmpty: contextMenuSelectionEmpty.value,
    viewMode: viewMode.value,
  }),
);

let editor: Vditor | undefined;
let editorReady = false;
let currentValue = props.modelValue;
let pendingExternalValue: string | undefined;
let pendingFocus = false;
let pendingListConversion = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let activeTableCell: HTMLTableCellElement | undefined;

function localAssetBase(): string {
  return new URL("vendor/vditor", document.baseURI)
    .toString()
    .replace(/\/$/, "");
}

function escapeHintHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function wikilinkTarget(path: string): string {
  return path.replace(/\.md$/iu, "");
}

function wikilinkHints(query: string) {
  const needle = query.toLocaleLowerCase();
  return props.wikilinkSuggestions
    .filter(({ label, path }) => {
      const target = wikilinkTarget(path);
      return (
        label.toLocaleLowerCase().includes(needle) ||
        path.toLocaleLowerCase().includes(needle) ||
        target.toLocaleLowerCase().includes(needle)
      );
    })
    .slice(0, 8)
    .map(({ label, path }) => ({
      html: `${escapeHintHtml(label)} <small>${escapeHintHtml(path)}</small>`,
      value: `[[${wikilinkTarget(path)}]]`,
    }));
}

function scheduleSave(value: string) {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    emit("save", value);
  }, 500);
}

function handleInput(value: string) {
  renderEmptyListMarker();

  if (value === currentValue) {
    return;
  }

  currentValue = value;
  emit("update:modelValue", value);
  scheduleSave(value);
}

function renderEmptyListMarker() {
  if (pendingListConversion || !editorRoot.value) {
    return;
  }

  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  const anchorElement =
    anchor instanceof Element ? anchor : anchor?.parentElement;
  const paragraph = anchorElement?.closest("p");
  if (!paragraph || !editorRoot.value.contains(paragraph)) {
    return;
  }

  const marker = paragraph.textContent ?? "";
  const command = /^[-+*] $/.test(marker)
    ? "list"
    : /^\d+[.)] $/.test(marker)
      ? "ordered-list"
      : undefined;
  if (!command) {
    return;
  }

  pendingListConversion = true;
  queueMicrotask(() => {
    pendingListConversion = false;
    if (!paragraph.isConnected || !editorRoot.value) {
      return;
    }

    paragraph.innerHTML = "<wbr>";
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);

    editorRoot.value
      .querySelector<HTMLButtonElement>(
        `.vditor-toolbar button[data-type="${command}"]`,
      )
      ?.click();
  });
}

function applyAccessibility() {
  const root = editorRoot.value;
  if (!root) {
    return;
  }

  for (const inactive of root.querySelectorAll<HTMLElement>(
    '[aria-label="Éditeur Markdown"]',
  )) {
    inactive.removeAttribute("aria-label");
    inactive.removeAttribute("aria-multiline");
    inactive.removeAttribute("role");
  }
  const editable = root.querySelector<HTMLElement>(
    viewMode.value === "sv"
      ? '.vditor-sv[contenteditable="true"]'
      : '.vditor-ir [contenteditable="true"]',
  );
  if (!editable) {
    root.setAttribute("aria-label", "Éditeur Markdown");
    return;
  }

  root.removeAttribute("aria-label");
  editable.setAttribute("aria-label", "Éditeur Markdown");
  editable.setAttribute("aria-multiline", "true");
  editable.setAttribute("role", "textbox");
  editable.setAttribute("lang", "fr");
  editable.setAttribute("spellcheck", "true");
  editable.setAttribute("inputmode", "text");
  editable.setAttribute("autocapitalize", "off");
}

function hideEngineToolbar() {
  const toolbar =
    editorRoot.value?.querySelector<HTMLElement>(".vditor-toolbar");
  if (!toolbar) return;
  // Preserve Vditor's command/hotkey DOM without exposing an unusable toolbar.
  toolbar.setAttribute("aria-hidden", "true");
  toolbar.removeAttribute("role");
  toolbar.removeAttribute("aria-label");
  toolbar.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.tabIndex = -1;
  });
}

function selectedTableCell(): HTMLTableCellElement | undefined {
  const root = editorRoot.value;
  if (!root) {
    return undefined;
  }

  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
  const node = range?.startContainer;
  const element = node instanceof Element ? node : node?.parentElement;
  const cell = element?.closest<HTMLTableCellElement>("td, th");

  return cell && root.contains(cell) ? cell : undefined;
}

function tableCellFromTarget(
  target: EventTarget | null,
): HTMLTableCellElement | undefined {
  const element = target instanceof Element ? target : undefined;
  const cell = element?.closest<HTMLTableCellElement>("td, th");

  return cell && editorRoot.value?.contains(cell) ? cell : undefined;
}

function activeOrSelectedTableCell(): HTMLTableCellElement | undefined {
  if (
    activeTableCell?.isConnected &&
    editorRoot.value?.contains(activeTableCell)
  ) {
    return activeTableCell;
  }

  return selectedTableCell();
}

function closeContextMenu() {
  contextMenuOpen.value = false;
}

function isEditorWritingArea(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  if (!element || !editorRoot.value?.contains(element)) {
    return false;
  }
  if (element.closest(".vditor-toolbar, .synapse-edit-mode-host")) {
    return false;
  }
  return Boolean(
    element.closest(
      '.vditor-ir, .vditor-sv, .vditor-content, [contenteditable="true"]',
    ),
  );
}

function clickToolbarButton(selector: string) {
  editorRoot.value?.querySelector<HTMLButtonElement>(selector)?.click();
}

function activeEditable(): HTMLElement | undefined {
  return (
    editorRoot.value?.querySelector<HTMLElement>(
      viewMode.value === "sv"
        ? '.vditor-sv[contenteditable="true"]'
        : '.vditor-ir [contenteditable="true"]',
    ) ?? undefined
  );
}

function focusEditor() {
  const editable = activeEditable();
  if (!editable) {
    return;
  }

  editable.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editable);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function onEditorKeydown(event: KeyboardEvent) {
  if (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "k" &&
    isEditorWritingArea(event.target)
  ) {
    event.preventDefault();
    event.stopPropagation();
    clickToolbarButton('.vditor-toolbar button[data-type="link"]');
  }
}

function editorSelection(): string {
  return editor?.getSelection() ?? "";
}

function insertWrapped(prefix: string, suffix: string, placeholder: string) {
  const selected = editorSelection();
  if (selected) {
    editor?.deleteValue();
  }
  editor?.insertValue(`${prefix}${selected || placeholder}${suffix}`);
}

function replaceSelection(replace: (selected: string) => string) {
  const selected = editorSelection();
  if (!selected) {
    return false;
  }
  editor?.deleteValue();
  editor?.insertValue(replace(selected));
  return true;
}

function clearHeading() {
  // IR mode renders the current block as an <h1>..<h6> holding a heading
  // marker span; emptying it and notifying the input pipeline removes the
  // heading. Source mode falls back to stripping the hashes of the selection.
  const anchor = window.getSelection()?.anchorNode;
  const element = anchor instanceof Element ? anchor : anchor?.parentElement;
  const heading = element?.closest<HTMLElement>("h1,h2,h3,h4,h5,h6");
  if (
    heading &&
    editorRoot.value?.contains(heading) &&
    editor?.getCurrentMode() === "ir"
  ) {
    const marker = heading.querySelector<HTMLElement>(
      ".vditor-ir__marker--heading",
    );
    if (marker) {
      marker.textContent = "";
      heading.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return;
    }
  }
  replaceSelection((selected) => selected.replace(/^#{1,6} /gmu, ""));
}

function insertFootnote() {
  const value = editor?.getValue() ?? "";
  const used = [...value.matchAll(/\[\^(\d+)\]/gmu)].map((match) =>
    Number(match[1]),
  );
  const next = (used.length ? Math.max(...used) : 0) + 1;
  editor?.insertValue(`[^${next}]\n\n[^${next}]: `);
}

function restoreContextMenuSelection(): boolean {
  const range = contextMenuRange;
  const editable = activeEditable();
  if (
    !range ||
    !editable ||
    !editable.contains(range.commonAncestorContainer)
  ) {
    return false;
  }
  editable.focus({ preventScroll: true });
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range.cloneRange());
  return true;
}

async function pastePlainText() {
  if (!navigator.clipboard?.readText) {
    clipboardStatus.value = "Presse-papiers indisponible : utilisez Ctrl+V.";
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    if (!restoreContextMenuSelection()) return;
    editor?.insertValue(text);
    clipboardStatus.value = "";
  } catch {
    // Reading is permission-gated; never log contents or silently claim success.
    clipboardStatus.value = "Accès au presse-papiers refusé : utilisez Ctrl+V.";
  }
}

function copyOrCut(cut: boolean) {
  const selected = contextMenuRange?.toString() ?? "";
  if (!selected || !restoreContextMenuSelection()) return;
  const copied = document.execCommand("copy");
  if (copied) {
    if (cut && restoreContextMenuSelection()) editor?.deleteValue();
    clipboardStatus.value = "";
    return;
  }
  if (!navigator.clipboard?.writeText) {
    clipboardStatus.value = "Presse-papiers indisponible : utilisez Ctrl+C.";
    return;
  }
  void navigator.clipboard.writeText(selected).then(
    () => {
      if (cut && restoreContextMenuSelection()) editor?.deleteValue();
      clipboardStatus.value = "";
    },
    () => {
      clipboardStatus.value =
        "Accès au presse-papiers refusé : utilisez Ctrl+C.";
    },
  );
}

function selectAllInEditor() {
  const editable = editor?.vditor?.ir?.element ?? editor?.vditor?.sv?.element;
  editable?.focus();
  document.execCommand("selectAll");
}

function runEditorCommand(id: string) {
  const emoji = emojiForCommand(id);
  if (emoji) {
    if (restoreContextMenuSelection()) editor?.insertValue(emoji);
    return;
  }
  if (id === "mode-ir" || id === "mode-sv") {
    applyViewMode(id === "mode-ir" ? "ir" : "sv");
    return;
  }
  if (id === "code-block") {
    clickToolbarButton('.vditor-toolbar button[data-type="code"]');
    return;
  }
  if (id === "add-link") {
    clickToolbarButton('.vditor-toolbar button[data-type="link"]');
    return;
  }
  if (id === "add-external-link") {
    insertWrapped("[", "](https://)", "texte");
    return;
  }
  if (id === "math-inline") {
    insertWrapped("$", "$", "E=mc^2");
    return;
  }
  if (id === "comment") {
    insertWrapped("%%", "%%", "commentaire");
    return;
  }
  if (id === "remove-format") {
    replaceSelection((selected) =>
      selected.replace(/(\*\*|\*|__|~~|==|`)/gu, "").replace(/^#{1,6} /gmu, ""),
    );
    return;
  }
  if (id === "body") {
    clearHeading();
    return;
  }
  if (id === "footnote") {
    insertFootnote();
    return;
  }
  if (id === "callout") {
    editor?.insertValue("> [!note] Titre\n> Contenu");
    return;
  }
  if (id === "math-block") {
    editor?.insertValue("$$\n\n$$");
    return;
  }
  if (id === "paste-plain" || id === "paste") {
    void pastePlainText();
    return;
  }
  if (id === "select-all") {
    selectAllInEditor();
    return;
  }
  if (id === "copy" || id === "cut") {
    copyOrCut(id === "cut");
    return;
  }
  if (
    id === "row-add" ||
    id === "row-add-above" ||
    id === "row-delete" ||
    id === "column-add" ||
    id === "column-add-before" ||
    id === "column-delete"
  ) {
    runTableAction(id);
    return;
  }
  if (/^h[1-6]$/u.test(id)) {
    clickToolbarButton(`.vditor-toolbar button[data-tag="${id}"]`);
    return;
  }
  clickToolbarButton(`.vditor-toolbar button[data-type="${id}"]`);
}

function runTableAction(
  action: TableAction,
  targetCell = activeOrSelectedTableCell(),
) {
  const cell = targetCell;
  const editable = editor?.vditor.ir?.element ?? editor?.vditor.sv?.element;
  if (!cell || !editable) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  editable.focus();

  editable.dispatchEvent(
    new KeyboardEvent("keydown", {
      ...TABLE_ACTION_SHORTCUTS[action],
      bubbles: true,
      cancelable: true,
    }),
  );

  activeTableCell = cell;
}

function applyViewMode(mode: "ir" | "sv") {
  persistViewMode(mode);
  if (!editorReady) {
    return;
  }
  if (editor?.getCurrentMode() === mode) {
    return;
  }
  clickToolbarButton(`.vditor-toolbar button[data-mode="${mode}"]`);
  applyAccessibility();
}

function focusWritingArea() {
  if (!editorReady) {
    pendingFocus = true;
    return;
  }
  editor?.focus();
  focusEditor();
}

defineExpose({ focus: focusWritingArea });

function handleTableFocus(event: FocusEvent) {
  const cell = tableCellFromTarget(event.target);
  if (cell) {
    activeTableCell = cell;
  }
}

function onEditorContextMenu(event: MouseEvent) {
  if (!isEditorWritingArea(event.target)) {
    return;
  }

  event.preventDefault();
  const cell = tableCellFromTarget(event.target);
  if (cell) {
    activeTableCell = cell;
  }
  contextMenuInTable.value = Boolean(cell);
  const anchor = event.target instanceof Element ? event.target : undefined;
  const heading = anchor?.closest<HTMLElement>("h1,h2,h3,h4,h5,h6");
  contextMenuHeadingLevel.value =
    heading && editorRoot.value?.contains(heading)
      ? Number(heading.tagName.charAt(1))
      : 0;
  const selection = window.getSelection();
  const range = selection?.rangeCount
    ? selection.getRangeAt(0).cloneRange()
    : undefined;
  contextMenuRange =
    range && editorRoot.value?.contains(range.commonAncestorContainer)
      ? range
      : undefined;
  contextMenuSelectionEmpty.value =
    !contextMenuRange || contextMenuRange.collapsed;
  clipboardStatus.value = "";
  contextMenuX.value = event.clientX;
  contextMenuY.value = event.clientY;
  contextMenuOpen.value = true;
}

function setupTableInteractions() {
  editorRoot.value?.addEventListener("focusin", handleTableFocus);
}

function teardownTableInteractions() {
  editorRoot.value?.removeEventListener("focusin", handleTableFocus);
  activeTableCell = undefined;
}

function applyExternalValue(value: string) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  currentValue = value;
  editor?.setValue(value, true);
}

function onEditorClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const wikilink = target?.closest("[data-wikilink]");
  const fromAttr = wikilink?.getAttribute("data-wikilink");
  if (fromAttr) {
    event.preventDefault();
    emit("open-wikilink", fromAttr);
    return;
  }
  const text = target?.textContent ?? "";
  const match = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/u.exec(text);
  if (match?.[1]) {
    emit("open-wikilink", match[1]);
  }
}

function filesFromDataTransfer(data: DataTransfer | null): File[] {
  return data ? Array.from(data.files) : [];
}

function onEditorPaste(event: ClipboardEvent) {
  const files = filesFromDataTransfer(event.clipboardData);
  if (files.length === 0) {
    return;
  }
  event.preventDefault();
  emit("attach-files", files);
}

function onEditorDrop(event: DragEvent) {
  const files = filesFromDataTransfer(event.dataTransfer);
  if (files.length === 0) {
    return;
  }
  event.preventDefault();
  emit("attach-files", files);
}

function rewriteAttachmentUrls() {
  const root = editorRoot.value;
  if (!root) {
    return;
  }
  for (const image of root.querySelectorAll("img")) {
    const src = image.getAttribute("src") ?? "";
    const mapped = props.attachmentUrls[src];
    if (mapped) {
      image.setAttribute("src", mapped);
    }
  }
  for (const link of root.querySelectorAll("a")) {
    const href = link.getAttribute("href") ?? "";
    const mapped = props.attachmentUrls[href];
    if (mapped) {
      link.setAttribute("href", mapped);
      link.setAttribute("download", href.split("/").pop() ?? "fichier");
    }
  }
}

onMounted(() => {
  if (!editorRoot.value) {
    return;
  }

  const cdn = localAssetBase();
  const dark = themeMode.value === "dark";

  editor = new Vditor(editorRoot.value, {
    cache: { enable: false },
    cdn,
    height: "100%",
    hint: {
      emojiPath: `${cdn}/dist/images/emoji`,
      extend: [{ hint: wikilinkHints, key: "[[" }],
    },
    image: { isPreview: false },
    lang: "fr_FR",
    link: { isOpen: false },
    minHeight: 320,
    mode: viewMode.value,
    placeholder: "Écrivez en Markdown…",
    undoDelay: 80,
    preview: {
      hljs: {
        defaultLang: "",
        enable: true,
        lineNumber: false,
        style: dark ? "github-dark" : "github",
      },
      markdown: {
        autoSpace: false,
        callout: true,
        codeBlockPreview: true,
        fixTermTypo: false,
        footnotes: true,
        gfmAutoLink: true,
        listStyle: true,
        mathBlockPreview: true,
        paragraphBeginningSpace: false,
        sanitize: true,
      },
      math: {
        engine: "KaTeX",
        inlineDigit: false,
        macros: {},
      },
      mode: "editor",
      render: {
        media: { enable: false },
      },
      theme: {
        current: dark ? "dark" : "light",
        path: `${cdn}/dist/css/content-theme`,
      },
    },
    tab: "    ",
    theme: dark ? "dark" : "classic",
    toolbar: [
      // Common actions upfront; secondary actions live in the keyboard
      // accessible "Plus" overflow so the toolbar stays a bounded row.
      "headings",
      "bold",
      "italic",
      "strike",
      // Ctrl+K must stay free for the global search palette; insert-link
      // answers on Ctrl+Shift+K instead (engine-resolved from ⇧⌘K).
      { name: "link", hotkey: LINK_TOOLBAR_HOTKEY },
      "list",
      "quote",
      "|",
      "undo",
      "redo",
      "|",
      {
        name: "more",
        toolbar: [
          "emoji",
          "|",
          "ordered-list",
          "check",
          "outdent",
          "indent",
          "|",
          "code",
          "inline-code",
          "|",
          "line",
          "table",
        ],
      },
      { className: "synapse-edit-mode-host", name: "edit-mode" },
    ],
    value: props.modelValue,
    width: "100%",
    input: handleInput,
    after: () => {
      editorReady = true;
      applyAccessibility();
      hideEngineToolbar();
      setupTableInteractions();
      rewriteAttachmentUrls();

      if (pendingExternalValue !== undefined) {
        const value = pendingExternalValue;
        pendingExternalValue = undefined;
        applyExternalValue(value);
      }

      if (pendingFocus) {
        pendingFocus = false;
        editor?.focus();
        focusEditor();
      }
    },
  });

  // Kept on the mount point as a stable fallback while Vditor loads its local
  // language and parser assets asynchronously.
  applyAccessibility();
});

watch(
  () => props.modelValue,
  (value) => {
    if (value === currentValue) {
      return;
    }

    if (!editorReady) {
      currentValue = value;
      pendingExternalValue = value;
      return;
    }

    applyExternalValue(value);
    rewriteAttachmentUrls();
  },
);

watch(
  () => props.attachmentUrls,
  () => rewriteAttachmentUrls(),
  { deep: true },
);

watch(themeMode, (mode) => {
  if (!editorReady) {
    return;
  }

  const dark = mode === "dark";
  editor?.setTheme(
    dark ? "dark" : "classic",
    dark ? "dark" : "light",
    dark ? "github-dark" : "github",
    `${localAssetBase()}/dist/css/content-theme`,
  );
});

onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  teardownTableInteractions();
  editor?.destroy();
});
</script>

<template>
  <div
    class="markdown-editor"
    @click="onEditorClick"
    @contextmenu="onEditorContextMenu"
    @drop="onEditorDrop"
    @keydown.capture="onEditorKeydown"
    @paste="onEditorPaste"
  >
    <div aria-label="Mode d'édition" class="markdown-editor-mode" role="group">
      <button
        :aria-pressed="viewMode === 'ir'"
        type="button"
        @click="applyViewMode('ir')"
      >
        Markdown
      </button>
      <button
        :aria-pressed="viewMode === 'sv'"
        type="button"
        @click="applyViewMode('sv')"
      >
        Texte brut
      </button>
    </div>
    <div
      ref="editorRoot"
      class="markdown-editor-host"
      data-editor-engine="vditor"
    />
    <p
      v-if="clipboardStatus"
      class="markdown-editor-clipboard-status"
      role="status"
    >
      {{ clipboardStatus }}
    </p>
    <MarkdownContextMenu
      :items="contextMenuItems"
      :open="contextMenuOpen"
      :x="contextMenuX"
      :y="contextMenuY"
      @close="closeContextMenu"
      @select="runEditorCommand"
    />
  </div>
</template>

<style scoped>
.markdown-editor {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 100%;
  min-height: inherit;
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
}

.markdown-editor-clipboard-status {
  position: absolute;
  inset-block-end: 0.75rem;
  inset-inline-start: 0.75rem;
  z-index: var(--synapse-z-panel);
  max-width: calc(100% - 1.5rem);
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
  box-shadow: var(--synapse-shadow-sm);
  font-size: 0.8rem;
}

.markdown-editor-mode {
  display: flex;
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: 0.25rem;
  padding: 0.35rem 0.75rem 0;
  background: var(--synapse-color-surface-muted);
}

.markdown-editor-mode button {
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: 0.4rem;
  color: var(--synapse-color-text-muted);
  background: var(--synapse-color-surface-raised);
  font-size: 0.75rem;
  font-weight: 650;
}

.markdown-editor-mode button[aria-pressed="true"] {
  color: var(--synapse-color-accent-strong);
  border-color: color-mix(
    in srgb,
    var(--synapse-color-accent) 35%,
    var(--synapse-color-border)
  );
  background: color-mix(in srgb, var(--synapse-color-accent) 12%, transparent);
}

.markdown-editor-mode button:hover,
.markdown-editor-mode button:focus-visible {
  color: var(--synapse-color-text);
  outline: none;
}

.markdown-editor-host {
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 0;
}

.markdown-editor.vditor,
.markdown-editor :deep(.vditor),
.markdown-editor-host.vditor {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 100%;
  min-height: inherit;
  border: 0;
  border-radius: 0;
  background: var(--synapse-color-surface-raised);
}

/* Vditor still mounts command buttons and registers shortcuts, but the
   right-click menu is the sole visible formatting surface. */
.markdown-editor :deep(.vditor-toolbar) {
  display: none !important;
}

.markdown-editor :deep(.vditor-content),
.markdown-editor :deep(.vditor-ir),
.markdown-editor :deep(.vditor-sv) {
  min-width: 0;
  background: var(--synapse-color-surface-raised);
}

.markdown-editor :deep(.vditor-ir),
.markdown-editor :deep(.vditor-sv) {
  color: var(--synapse-color-text);
  font-family: var(--synapse-font-sans);
  font-size: 1rem;
  line-height: 1.65;
  caret-color: var(--synapse-color-accent);
}

.markdown-editor :deep(.vditor-ir > .vditor-reset),
.markdown-editor :deep(.vditor-sv) {
  display: block;
  box-sizing: border-box;
  width: 100% !important;
  /* Use the available workspace without stretching lines edge-to-edge on
     ultrawide displays. The same width applies to IR and source modes. */
  max-width: min(100%, 60rem) !important;
  min-width: 0;
  margin-inline: auto !important;
  padding: 2rem clamp(1.25rem, 4vw, 2.5rem) !important;
}

/* Vditor paints its IR pre with its own dark panel color (#24292e), leaving
   a conspicuous rectangle against the Synapse canvas. Keep the whole writing
   area on the same surface in both themes, including while focused. */
.markdown-editor :deep(.vditor-ir > .vditor-reset),
.markdown-editor :deep(.vditor-ir > .vditor-reset:focus) {
  background: var(--synapse-color-surface-raised);
}

.markdown-editor :deep(.vditor-ir:focus),
.markdown-editor :deep(.vditor-sv:focus) {
  outline: none;
}

.markdown-editor :deep(.vditor-reset ul),
.markdown-editor :deep(.vditor-reset ol) {
  padding-inline-start: 4ch;
}

.markdown-editor :deep(.vditor-reset blockquote) {
  border-inline-start-color: var(--synapse-color-accent);
  color: var(--synapse-color-text-muted);
}

.markdown-editor :deep(.vditor-reset code) {
  font-family: var(--synapse-font-mono);
}
</style>
