<script setup lang="ts">
import Vditor from "vditor";
import "vditor/dist/index.css";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useEditorMode } from "../editor-mode";
import {
  markdownContextMenuGroups,
  TOOLBAR_LABELS,
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

const contextMenuGroups = computed(() =>
  markdownContextMenuGroups({
    inTable: contextMenuInTable.value,
    viewMode: viewMode.value,
  }),
);

let editor: Vditor | undefined;
let editorReady = false;
let currentValue = props.modelValue;
let pendingExternalValue: string | undefined;
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

  const editable = root.querySelector<HTMLElement>(
    '.vditor-ir [contenteditable="true"], .vditor-sv[contenteditable="true"]',
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

function applyToolbarLabels() {
  const toolbar =
    editorRoot.value?.querySelector<HTMLElement>(".vditor-toolbar");
  if (!toolbar) {
    return;
  }

  toolbar.classList.add("synapse-toolbar");
  toolbar.setAttribute("aria-label", "Mise en forme Markdown");
  toolbar.setAttribute("role", "toolbar");

  toolbar
    .querySelectorAll<HTMLButtonElement>("button[data-type]")
    .forEach((button) => {
      const type = button.dataset.type;
      const label = type ? TOOLBAR_LABELS[type] : undefined;
      if (!label || button.querySelector(".synapse-toolbar-label")) {
        return;
      }

      const text = document.createElement("span");
      text.className = "synapse-toolbar-label";
      text.setAttribute("aria-hidden", "true");
      text.textContent = label;
      button.appendChild(text);
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

function runEditorCommand(id: string) {
  if (id === "markdown") {
    applyViewMode("ir");
    return;
  }
  if (id === "source") {
    applyViewMode("sv");
    return;
  }
  if (id === "copy" || id === "cut" || id === "paste") {
    document.execCommand(id);
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
    toolbarConfig: { pin: true },
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
      "emoji",
      "headings",
      "bold",
      "italic",
      "strike",
      "link",
      "|",
      "list",
      "ordered-list",
      "check",
      "outdent",
      "indent",
      "|",
      "quote",
      "line",
      "code",
      "inline-code",
      "table",
      "|",
      "undo",
      "redo",
      { className: "synapse-edit-mode-host", name: "edit-mode" },
    ],
    value: props.modelValue,
    width: "100%",
    input: handleInput,
    after: () => {
      editorReady = true;
      applyAccessibility();
      applyToolbarLabels();
      setupTableInteractions();
      rewriteAttachmentUrls();

      if (pendingExternalValue !== undefined) {
        const value = pendingExternalValue;
        pendingExternalValue = undefined;
        applyExternalValue(value);
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
    <MarkdownContextMenu
      :groups="contextMenuGroups"
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

.markdown-editor :deep(.synapse-toolbar),
.markdown-editor :deep(.vditor-toolbar) {
  display: flex !important;
  flex-flow: row wrap !important;
  align-items: center;
  align-content: center;
  align-self: stretch;
  justify-content: center !important;
  box-sizing: border-box;
  width: 100% !important;
  max-width: 100%;
  min-width: 0 !important;
  margin: 0;
  gap: 0.15rem;
  /* Vditor aligns this inline with the 800px writing column. The toolbar
     itself must stay centered across the full editor surface. */
  padding: 0.35rem 0.75rem !important;
  border-color: var(--synapse-color-border);
  background: var(--synapse-color-surface-muted);
  line-height: normal;
  text-align: center;
  overflow: visible;
}

.markdown-editor :deep(.vditor-toolbar__item),
.markdown-editor :deep(.vditor-toolbar__divider) {
  float: none !important;
  display: inline-flex !important;
  flex: 0 0 auto;
  width: auto !important;
  max-width: 100%;
  margin: 0;
  vertical-align: middle;
}

.markdown-editor :deep(.vditor-toolbar__divider) {
  align-self: stretch;
  margin-inline: 0.3rem;
}

.markdown-editor :deep(.vditor-toolbar__item .vditor-tooltipped) {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  width: auto;
  min-width: 2rem;
  height: 2rem;
  padding: 0.4rem 0.55rem;
  border-radius: 0.4rem;
  color: var(--synapse-color-text-muted);
  font-size: 0.75rem;
  font-weight: 650;
}

.markdown-editor :deep(.vditor-toolbar__item svg) {
  display: block;
  width: 14px !important;
  height: 14px !important;
  min-width: 14px;
  max-width: 14px;
  flex-shrink: 0;
}

.markdown-editor :deep(.vditor-toolbar__item .vditor-tooltipped:hover),
.markdown-editor :deep(.vditor-toolbar__item .vditor-tooltipped:focus-visible),
.markdown-editor :deep(.vditor-toolbar__item--current .vditor-tooltipped) {
  color: var(--synapse-color-accent-strong);
  background: color-mix(in srgb, var(--synapse-color-accent) 12%, transparent);
}

.markdown-editor :deep(.synapse-toolbar-label) {
  white-space: nowrap;
}

.markdown-editor :deep(.synapse-edit-mode-host) {
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
  max-width: none !important;
  min-width: 0;
  margin: 0 !important;
  padding: 1.5rem clamp(2rem, 8vw, 8rem) !important;
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
