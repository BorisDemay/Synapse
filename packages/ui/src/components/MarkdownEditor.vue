<script setup lang="ts">
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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

const updateListener = EditorView.updateListener.of((update) => {
  if (!update.docChanged || synchronizingExternalValue) {
    return;
  }

  const value = update.state.doc.toString();
  emit("update:modelValue", value);
  scheduleSave(value);
});

onMounted(() => {
  if (!editorRoot.value) {
    return;
  }

  editor = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        updateListener,
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
