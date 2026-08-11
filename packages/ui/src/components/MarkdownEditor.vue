<script setup lang="ts">
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  save: [value: string];
}>();

const editorRoot = ref<HTMLElement>();
let editor: EditorView | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let synchronizingExternalValue = false;

function scheduleSave(value: string) {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    emit("save", value);
  }, 500);
}

function emitDoc() {
  if (!editor || synchronizingExternalValue) {
    return;
  }
  const value = editor.state.doc.toString();
  emit("update:modelValue", value);
  scheduleSave(value);
}

const updateListener = EditorView.updateListener.of((update) => {
  if (!update.docChanged || synchronizingExternalValue) {
    return;
  }
  emitDoc();
});

function wrapSelection(prefix: string, suffix = prefix) {
  if (!editor) {
    return false;
  }

  const { state } = editor;
  const selection = state.selection.main;
  const selected = state.sliceDoc(selection.from, selection.to);
  const insertion = `${prefix}${selected || "texte"}${suffix}`;
  const cursorOffset = selected
    ? insertion.length
    : prefix.length + "texte".length;

  editor.dispatch({
    changes: { from: selection.from, to: selection.to, insert: insertion },
    selection: {
      anchor: selection.from + (selected ? insertion.length : prefix.length),
      head: selection.from + cursorOffset,
    },
  });
  emitDoc();
  return true;
}

onMounted(() => {
  if (!editorRoot.value) {
    return;
  }

  editor = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        history(),
        lineNumbers(),
        markdown(),
        placeholder("Écrivez en Markdown…"),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          {
            key: "Mod-b",
            run: () => wrapSelection("**"),
          },
          {
            key: "Mod-i",
            run: () => wrapSelection("*"),
          },
          {
            key: "Mod-e",
            run: () => wrapSelection("`"),
          },
        ]),
        updateListener,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "Éditeur Markdown" }),
      ],
    }),
    parent: editorRoot.value,
  });
});

watch(
  () => props.modelValue,
  (value) => {
    if (!editor || editor.state.doc.toString() === value) {
      return;
    }

    synchronizingExternalValue = true;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
    });
    synchronizingExternalValue = false;
  },
);

onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  editor?.destroy();
});
</script>

<template>
  <div ref="editorRoot" class="markdown-editor" />
</template>

<style scoped>
.markdown-editor {
  min-height: inherit;
}

.markdown-editor :deep(.cm-editor) {
  height: 100%;
  outline: none;
}

.markdown-editor :deep(.cm-scroller) {
  font-family: "IBM Plex Mono", "Cascadia Code", "Consolas", monospace;
  font-size: 0.95rem;
  line-height: 1.5;
}
</style>
