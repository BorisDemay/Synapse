import "fake-indexeddb/auto";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CODEX_RESPONSES_URL } from "../ai/codex-client";
import { openOfflineDb, resetOfflineDbHandle } from "../offline/cache";
import { useAssistantStore } from "./assistant";
import { useAuthStore } from "./auth";
import { useVaultStore } from "./vault";

const userId = "0198e5de-user-7000-8000-000000000001";
const vaultId = "0198e5de-1111-7222-8333-444455556666";
const noteId = "0198e5de-7777-7888-8999-aaaabbbbcccc";
const otherNoteId = "0198e5de-aaaa-7bbb-8ccc-ddddeeeeffff";
const token = "sk-test-secret-token-do-not-leak";

const chatgptCatalog = {
  models: [
    {
      default_reasoning_level: "medium",
      display_name: "GPT-5.6 Sol",
      priority: 1,
      service_tiers: [
        {
          description: "Priority processing.",
          id: "fast",
          name: "Fast",
        },
      ],
      slug: "gpt-5.6-sol",
      supported_reasoning_levels: [
        { description: "Faster", effort: "low" },
        { description: "Balanced", effort: "medium" },
        { description: "Deeper", effort: "high" },
      ],
      visibility: "list",
    },
    {
      display_name: "GPT-5.6 Terra",
      priority: 2,
      slug: "gpt-5.6-terra",
      visibility: "list",
    },
    {
      display_name: "GPT-5.6 Luna",
      priority: 3,
      slug: "gpt-5.6-luna",
      visibility: "list",
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function stubOpenAi(reply: unknown = "ok") {
  vi.mocked(fetch).mockImplementation(async (url) => {
    const href = String(url);
    if (href.includes("/v1/models") || href.includes("/codex/models")) {
      return href.includes("chatgpt.com")
        ? jsonResponse(chatgptCatalog)
        : jsonResponse({
            data: chatgptCatalog.models.map((model) => ({ id: model.slug })),
          });
    }
    if (href.includes("/responses")) {
      return jsonResponse(
        typeof reply === "string" ? { output_text: reply } : reply,
      );
    }
    return jsonResponse({}, 404);
  });
}

async function unlockVault() {
  const vault = useVaultStore();
  vault.unlock(
    Uint8Array.from({ length: 32 }, (_, index) => index),
    vaultId,
    0,
  );
  vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
  await vault.saveNote({
    content: "# Secret diary\n\nKeep private.",
    id: noteId,
  });
  await vault.saveNote({
    content: "# Public outline\n\nNot attached.",
    id: otherNoteId,
  });
  vi.mocked(fetch).mockReset();
}

describe("assistant store", () => {
  beforeEach(() => {
    resetOfflineDbHandle();
    indexedDB.deleteDatabase("synapse-offline-v1");
    resetOfflineDbHandle();
    setActivePinia(createPinia());
    useAuthStore().userId = userId;
    useAuthStore().isAuthenticated = true;
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("window", {
      location: { origin: "https://synapse.local" },
      open: vi.fn(),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("wraps the Codex token locally and never writes it in plaintext", async () => {
    await unlockVault();
    stubOpenAi();
    const assistant = useAssistantStore();
    await assistant.connect(token);

    expect(assistant.connected).toBe(true);
    const db = await openOfflineDb();
    const dumped = JSON.stringify(await db.getAll("ai_credentials"));
    expect(dumped).not.toContain(token);
    expect(dumped).not.toContain("Secret diary");
  });

  it("lets Codex replace an attached note through a local tool and syncs it encrypted", async () => {
    await unlockVault();
    const replacement = "# Secret diary\n\nReformulé.";
    const response = {
      output: [
        {
          arguments: JSON.stringify({ markdown: replacement, note_id: noteId }),
          call_id: "call-replace-1",
          name: "replace_linked_note",
          type: "function_call",
        },
      ],
    };
    stubOpenAi(response);
    const assistant = useAssistantStore();
    await assistant.connect(token);
    assistant.attachNote(noteId);
    vi.mocked(fetch).mockClear();
    stubOpenAi(response);

    await assistant.send("Reformule cette note.");
    await useVaultStore().flushPendingOperations();

    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] =
      vi
        .mocked(fetch)
        .mock.calls.find(
          ([requestUrl]) => requestUrl === CODEX_RESPONSES_URL,
        ) ?? [];
    expect(url).toBe(CODEX_RESPONSES_URL);
    expect(String(url)).not.toContain("/auth/");
    const body = String(init?.body);
    expect(body).toContain("Secret diary");
    expect(body).toContain("Reformule cette note.");
    expect(body).not.toContain("Not attached.");
    expect(JSON.parse(body).store).toBe(false);
    expect(JSON.parse(body).tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "create_note", strict: true }),
        expect.objectContaining({ name: "replace_linked_note", strict: true }),
        expect.objectContaining({
          name: "append_to_linked_note",
          strict: true,
        }),
      ]),
    );
    expect(body).toContain(noteId);
    expect(assistant.messages.at(-1)?.content).toBe(
      "Note mise à jour : Secret diary",
    );
    expect(useVaultStore().notes.get(noteId)?.content).toBe(replacement);

    const [, syncInit] =
      vi
        .mocked(fetch)
        .mock.calls.find(([requestUrl]) =>
          String(requestUrl).includes("/v1/vaults/"),
        ) ?? [];
    expect(String(syncInit?.body)).not.toContain("Secret diary");
    expect(String(syncInit?.body)).not.toContain("Reformulé.");
  });

  it("crée une note seulement lorsque Codex choisit l'outil de création", async () => {
    await unlockVault();
    const markdown = "# Nouvelle note\n\nNouveau texte.";
    stubOpenAi({
      output: [
        {
          arguments: JSON.stringify({ markdown }),
          call_id: "call-create-1",
          name: "create_note",
          type: "function_call",
        },
      ],
    });
    const assistant = useAssistantStore();
    await assistant.connect(token);
    const createdNoteId = await assistant.send("Rédige une nouvelle note.");

    expect(createdNoteId).not.toBe(noteId);
    expect(useVaultStore().notes.get(createdNoteId)?.content).toBe(markdown);
  });

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
      await unlockVault();
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
      await unlockVault();
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

  it("persists separate encrypted conversations and restores their active thread", async () => {
    await unlockVault();
    const prompt = "Crée mon plan de voyage privé.";
    stubOpenAi({
      output: [
        {
          arguments: JSON.stringify({ markdown: "# Voyage\n\nItinéraire." }),
          call_id: "call-conversation-1",
          name: "create_note",
          type: "function_call",
        },
      ],
    });
    const assistant = useAssistantStore();
    await assistant.connect(token);
    const initialConversationCount = assistant.conversations.length;

    const firstConversationId = await assistant.newConversation();
    await assistant.send(prompt);
    const secondConversationId = await assistant.newConversation();

    expect(assistant.activeConversationId).toBe(secondConversationId);
    expect(assistant.messages).toEqual([]);
    expect(assistant.conversations).toHaveLength(initialConversationCount + 2);

    await assistant.openConversation(firstConversationId);
    expect(assistant.activeConversationId).toBe(firstConversationId);
    expect(assistant.messages[0]?.content).toBe(prompt);
    expect(
      assistant.conversations.find(
        (conversation) => conversation.id === firstConversationId,
      )?.title,
    ).toBe("Crée mon plan de voyage privé.");

    const db = await openOfflineDb();
    const dumped = JSON.stringify(await db.getAll("ai_conversations"));
    expect(dumped).not.toContain(prompt);
    expect(dumped).not.toContain("Itinéraire.");

    assistant.lockSession();
    await assistant.restore();
    expect(assistant.activeConversationId).toBe(firstConversationId);
    expect(assistant.messages[0]?.content).toBe(prompt);
  });

  it("refuses a mutation targeting a note that was not explicitly attached", async () => {
    await unlockVault();
    stubOpenAi({
      output: [
        {
          arguments: JSON.stringify({
            markdown: "# Public outline\n\nModifiée.",
            note_id: otherNoteId,
          }),
          call_id: "call-forbidden-1",
          name: "replace_linked_note",
          type: "function_call",
        },
      ],
    });
    const assistant = useAssistantStore();
    await assistant.connect(token);
    assistant.attachNote(noteId);

    await expect(assistant.send("Modifie cette note.")).rejects.toThrow(
      "note liée explicitement",
    );
    expect(useVaultStore().notes.get(otherNoteId)?.content).toBe(
      "# Public outline\n\nNot attached.",
    );
  });

  it("forgets the token on lock while keeping the wrapped envelope", async () => {
    await unlockVault();
    stubOpenAi();
    const assistant = useAssistantStore();
    await assistant.connect(token);
    await assistant.lockSession();
    expect(assistant.connected).toBe(false);
    vi.mocked(fetch).mockClear();
    stubOpenAi("nope");
    await expect(assistant.send("hello")).rejects.toThrow(
      "Connectez l’assistant pour écrire.",
    );
    expect(fetch).not.toHaveBeenCalled();

    await assistant.restore();
    expect(assistant.connected).toBe(true);
  });

  it("refuses every tool call when a provider answers with several", async () => {
    await unlockVault();
    const glmBaseUrl = "https://open.bigmodel.cn/api/paas/v4";
    vi.mocked(fetch).mockImplementation(async (url) => {
      const href = String(url);
      if (href === `${glmBaseUrl}/models`) {
        return jsonResponse({ data: [{ id: "glm-4.6" }] });
      }
      if (href === `${glmBaseUrl}/chat/completions`) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "",
                role: "assistant",
                tool_calls: [
                  {
                    function: {
                      arguments: JSON.stringify({
                        markdown: "# Première note GLM\n\nContenu.",
                      }),
                      name: "create_note",
                    },
                    id: "call-glm-1",
                    type: "function",
                  },
                  {
                    function: {
                      arguments: JSON.stringify({
                        markdown: "# Deuxième note GLM\n\nContenu.",
                      }),
                      name: "create_note",
                    },
                    id: "call-glm-2",
                    type: "function",
                  },
                ],
              },
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    const assistant = useAssistantStore();
    await assistant.connect(token, { provider: "glm" });

    const prompt = "Crée deux notes.";
    const messageCountBeforeRequest = assistant.messages.length;
    await expect(assistant.send(prompt)).rejects.toThrow(
      "L’assistant a fourni plusieurs actions.",
    );

    const contents = [...useVaultStore().notes.values()].map(
      (note) => note.content,
    );
    expect(contents).not.toContain("# Première note GLM\n\nContenu.");
    expect(contents).not.toContain("# Deuxième note GLM\n\nContenu.");
    expect(assistant.messages).toHaveLength(messageCountBeforeRequest + 1);
    expect(assistant.messages.at(-1)?.content).toBe(prompt);
    expect(assistant.error).toBe("L’assistant a fourni plusieurs actions.");
    expect(assistant.error).not.toContain("Première note GLM");
    expect(assistant.error).not.toContain("Deuxième note GLM");
    expect(assistant.error).not.toContain(noteId);
    expect(assistant.error).not.toContain(token);
  });

  it("surfaces plain-text answers for requests that need no write", async () => {
    await unlockVault();
    const glmBaseUrl = "https://open.bigmodel.cn/api/paas/v4";
    vi.mocked(fetch).mockImplementation(async (url) => {
      const href = String(url);
      if (href === `${glmBaseUrl}/models`) {
        return jsonResponse({ data: [{ id: "glm-4.6" }] });
      }
      if (href === `${glmBaseUrl}/chat/completions`) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: "Je suis l’assistant d’écriture de Synapse.",
                role: "assistant",
              },
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    const assistant = useAssistantStore();
    await assistant.connect(token, { provider: "glm" });
    const notesBefore = useVaultStore().notes.size;

    await expect(assistant.send("Quel modèle es-tu ?")).resolves.toBe("");

    expect(assistant.messages.at(-1)?.content).toBe(
      "Je suis l’assistant d’écriture de Synapse.",
    );
    expect(assistant.messages.at(-1)?.role).toBe("assistant");
    expect(useVaultStore().notes.size).toBe(notesBefore);
  });

  it("tells the model which model and provider it runs as", async () => {
    await unlockVault();
    const glmBaseUrl = "https://open.bigmodel.cn/api/paas/v4";
    vi.mocked(fetch).mockImplementation(async (url) => {
      const href = String(url);
      if (href === `${glmBaseUrl}/models`) {
        return jsonResponse({ data: [{ id: "glm-4.6" }] });
      }
      if (href === `${glmBaseUrl}/chat/completions`) {
        return jsonResponse({
          choices: [{ message: { content: "D’accord.", role: "assistant" } }],
        });
      }
      return jsonResponse({}, 404);
    });
    const assistant = useAssistantStore();
    await assistant.connect(token, { provider: "glm" });

    await assistant.send("Quel modèle es-tu ?");

    const body = JSON.parse(
      String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body),
    ) as { messages?: Array<{ content?: string; role?: string }> };
    const system = body.messages?.find((message) => message.role === "system");
    expect(system?.content).toContain("glm-4.6");
    expect(system?.content).toContain("GLM (Zhipu)");
  });

  it("fails when the provider answers neither with tools nor text", async () => {
    await unlockVault();
    const glmBaseUrl = "https://open.bigmodel.cn/api/paas/v4";
    vi.mocked(fetch).mockImplementation(async (url) => {
      const href = String(url);
      if (href === `${glmBaseUrl}/models`) {
        return jsonResponse({ data: [{ id: "glm-4.6" }] });
      }
      if (href === `${glmBaseUrl}/chat/completions`) {
        return jsonResponse({
          choices: [{ message: { content: "", role: "assistant" } }],
        });
      }
      return jsonResponse({}, 404);
    });
    const assistant = useAssistantStore();
    await assistant.connect(token, { provider: "glm" });

    await expect(assistant.send("Crée une note.")).rejects.toThrow(
      "L’assistant n’a pas pu répondre.",
    );
  });

  it("connects a ChatGPT subscription through the Codex device-code flow", async () => {
    await unlockVault();
    const payload = btoa(
      JSON.stringify({
        "https://api.openai.com/auth": { chatgpt_account_id: "acct-42" },
      }),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    vi.mocked(fetch).mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("deviceauth/usercode")) {
        return jsonResponse({
          device_auth_id: "device-1",
          interval: "0",
          user_code: "ABCD-EFGH",
        });
      }
      if (href.includes("deviceauth/token")) {
        return jsonResponse({
          authorization_code: "auth-code",
          code_challenge: "challenge",
          code_verifier: "verifier",
        });
      }
      if (href.includes("oauth/token")) {
        return jsonResponse({
          access_token: "chatgpt-access-secret",
          expires_in: 3600,
          id_token: `eyJhbGciOiJub25lIn0.${payload}.sig`,
          refresh_token: "chatgpt-refresh-secret",
        });
      }
      if (href.includes("/codex/models")) {
        return jsonResponse(chatgptCatalog);
      }
      if (href.includes("/codex/responses")) {
        return jsonResponse({
          output: [
            {
              arguments: JSON.stringify({ markdown: "# Note abo." }),
              call_id: "call-subscription-1",
              name: "create_note",
              type: "function_call",
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });

    const assistant = useAssistantStore();
    await assistant.connectWithChatgpt();

    expect(assistant.connected).toBe(true);
    expect(assistant.models).toEqual([
      {
        defaultReasoningLevel: "medium",
        id: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        reasoningLevels: [
          { id: "low", label: "Faster" },
          { id: "medium", label: "Balanced" },
          { id: "high", label: "Deeper" },
        ],
        serviceTiers: [
          { description: "Priority processing.", id: "fast", name: "Fast" },
        ],
      },
      {
        id: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
        reasoningLevels: [],
        serviceTiers: [],
      },
      {
        id: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        reasoningLevels: [],
        serviceTiers: [],
      },
    ]);
    expect(assistant.model).toBe("gpt-5.6-sol");
    expect(assistant.reasoningEffort).toBe("medium");
    expect(assistant.fastTier?.id).toBe("fast");
    expect(window.open).toHaveBeenCalledWith(
      "https://auth.openai.com/codex/device",
      "_blank",
      "noopener,noreferrer",
    );
    const db = await openOfflineDb();
    const dumped = JSON.stringify(await db.getAll("ai_credentials"));
    expect(dumped).not.toContain("chatgpt-access-secret");
    expect(dumped).not.toContain("chatgpt-refresh-secret");

    await assistant.setReasoningEffort("high");
    await assistant.setFast(true);
    await assistant.send("Rédige.");
    const sendCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) =>
        String(url).includes("/backend-api/codex/responses"),
      );
    expect(sendCall?.[0]).toBe(
      "https://chatgpt.com/backend-api/codex/responses",
    );
    const body = JSON.parse(String(sendCall?.[1]?.body)) as {
      reasoning?: unknown;
      service_tier?: unknown;
    };
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.service_tier).toBe("fast");
    expect(JSON.stringify(body)).not.toContain("chatgpt-access-secret");
  });
});
