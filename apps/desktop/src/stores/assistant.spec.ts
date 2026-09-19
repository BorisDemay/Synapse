import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAssistantStore } from "./assistant";
import { useVaultStore } from "./vault";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const noteId = "notes/secret.md";
const token = "«redacted:sk-…»";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function stubOpenAi(reply: unknown) {
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).includes("/v1/models")) {
      return jsonResponse({ data: [{ id: "gpt-test" }] });
    }
    if (String(url).includes("/responses")) {
      return jsonResponse(reply);
    }
    return jsonResponse({});
  });
}

describe("assistant store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());
    useVaultStore().notes.set(noteId, { content: "# Secret\n\nOriginal." });
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    {
      arguments: { markdown: "# Tentative", note_id: noteId },
      label: "note_id",
    },
    {
      arguments: { markdown: "# Tentative", unexpected: true },
      label: "une clé inconnue",
    },
  ])(
    "refuses create_note when it contains $label without creating a note",
    async ({ arguments: argumentsValue }) => {
      stubOpenAi({
        output: [
          {
            arguments: JSON.stringify(argumentsValue),
            call_id: "call-invalid-create",
            name: "create_note",
            type: "function_call",
          },
        ],
      });
      const assistant = useAssistantStore();
      await assistant.connect(token);
      const notesBefore = useVaultStore().notes.size;

      await expect(assistant.send("Crée une note.")).rejects.toThrow(
        "L’assistant a demandé une action invalide.",
      );

      expect(assistant.error).toBe(
        "L’assistant a demandé une action invalide.",
      );
      expect(useVaultStore().notes.size).toBe(notesBefore);
    },
  );

  it.each([
    {
      arguments: {
        markdown: "# Secret remplacé",
        note_id: noteId,
        unexpected: true,
      },
      label: "contains an unknown key",
    },
    { arguments: { markdown: "# Secret remplacé" }, label: "omits note_id" },
  ])(
    "refuses replace_linked_note when it $label without modifying the note",
    async ({ arguments: argumentsValue }) => {
      stubOpenAi({
        output: [
          {
            arguments: JSON.stringify(argumentsValue),
            call_id: "call-invalid-replace",
            name: "replace_linked_note",
            type: "function_call",
          },
        ],
      });
      const assistant = useAssistantStore();
      await assistant.connect(token);
      assistant.attachNote(noteId);
      const original = useVaultStore().notes.get(noteId)?.content;

      await expect(assistant.send("Modifie cette note.")).rejects.toThrow(
        "L’assistant a demandé une action invalide.",
      );

      expect(assistant.error).toBe(
        "L’assistant a demandé une action invalide.",
      );
      expect(useVaultStore().notes.get(noteId)?.content).toBe(original);
    },
  );
});
