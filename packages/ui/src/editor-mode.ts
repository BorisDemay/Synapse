import { getCurrentInstance, onMounted, ref } from "vue";

export type EditorViewMode = "ir" | "sv";

export const EDITOR_MODE_STORAGE_KEY = "synapse-ui-editor-mode";

const mode = ref<EditorViewMode>("ir");
let initialized = false;

function readMode(): EditorViewMode {
  if (typeof window === "undefined") {
    return "ir";
  }

  return window.localStorage.getItem(EDITOR_MODE_STORAGE_KEY) === "sv"
    ? "sv"
    : "ir";
}

function persistMode(value: EditorViewMode) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(EDITOR_MODE_STORAGE_KEY, value);
}

export function resetEditorModeState() {
  mode.value = "ir";
  initialized = false;
}

export function initializeEditorMode() {
  if (typeof window === "undefined" || initialized) {
    return;
  }
  mode.value = readMode();
  initialized = true;
}

export function useEditorMode() {
  initializeEditorMode();

  if (getCurrentInstance()) {
    onMounted(() => {
      initializeEditorMode();
    });
  }

  function setMode(value: EditorViewMode) {
    mode.value = value;
    persistMode(value);
  }

  function toggleMode() {
    setMode(mode.value === "sv" ? "ir" : "sv");
  }

  return {
    mode,
    setMode,
    toggleMode,
  };
}
