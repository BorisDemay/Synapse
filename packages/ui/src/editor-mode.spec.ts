import { beforeEach, describe, expect, it } from "vitest";

import {
  EDITOR_MODE_STORAGE_KEY,
  initializeEditorMode,
  resetEditorModeState,
  useEditorMode,
} from "./editor-mode";

describe("useEditorMode", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetEditorModeState();
  });

  it("defaults to instant-rendering Markdown", () => {
    const editorMode = useEditorMode();

    expect(editorMode.mode.value).toBe("ir");
  });

  it("restores the raw source preference from localStorage", () => {
    window.localStorage.setItem(EDITOR_MODE_STORAGE_KEY, "sv");
    initializeEditorMode();

    const editorMode = useEditorMode();

    expect(editorMode.mode.value).toBe("sv");
  });

  it("persists the view mode without storing note content", () => {
    const editorMode = useEditorMode();

    editorMode.setMode("sv");

    expect(editorMode.mode.value).toBe("sv");
    expect(window.localStorage.getItem(EDITOR_MODE_STORAGE_KEY)).toBe("sv");
    expect(window.localStorage.getItem("vault-key")).toBeNull();
  });

  it("ignores unknown stored values", () => {
    window.localStorage.setItem(EDITOR_MODE_STORAGE_KEY, "wysiwyg");
    initializeEditorMode();

    expect(useEditorMode().mode.value).toBe("ir");
  });
});
