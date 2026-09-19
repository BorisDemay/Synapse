import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CODEX_RESPONSES_URL,
  completeCodexAgent,
  completeCodexChat,
  listCodexModels,
} from "./codex-client";
import { CODEX_CLIENT_VERSION } from "./codex-oauth";

const token = "sk-test-secret-token-do-not-leak";

describe("completeCodexChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the Codex Responses API without storing the conversation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ output_text: "Note reformulée." }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
    );

    await expect(
      completeCodexChat({
        instructions: "Rédige du Markdown.",
        messages: [{ content: "Reformule ceci.", role: "user" }],
        model: "gpt-5.6-luna",
        token,
      }),
    ).resolves.toBe("Note reformulée.");

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      CODEX_RESPONSES_URL,
      expect.objectContaining({
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );
    const body = JSON.parse(
      String(vi.mocked(fetch).mock.calls[0]?.[1]?.body),
    ) as {
      input: unknown;
      instructions: string;
      model: string;
      store: boolean;
    };
    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.store).toBe(false);
    expect(body.instructions).toBe("Rédige du Markdown.");
    expect(body.input).toEqual([{ content: "Reformule ceci.", role: "user" }]);
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("service_tier");
  });

  it("reads assistant text from typed output items when output_text is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            output: [
              {
                content: [{ text: "Brouillon.", type: "output_text" }],
                role: "assistant",
                type: "message",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      completeCodexChat({
        instructions: "x",
        messages: [{ content: "y", role: "user" }],
        model: "gpt-5.3-codex",
        token,
      }),
    ).resolves.toBe("Brouillon.");
  });

  it("returns a structured local tool call instead of treating it as note text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            output: [
              {
                arguments: JSON.stringify({
                  markdown: "# Note modifiée\n\nContenu.",
                  note_id: "note-1",
                }),
                call_id: "call-1",
                name: "replace_linked_note",
                type: "function_call",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      completeCodexAgent({
        instructions: "Utilise un outil local.",
        messages: [{ content: "Modifie la note liée.", role: "user" }],
        model: "gpt-5.6-luna",
        token,
        toolChoice: "required",
        tools: [
          {
            description: "Remplace une note liée.",
            name: "replace_linked_note",
            parameters: {
              additionalProperties: false,
              properties: {
                markdown: { type: "string" },
                note_id: { type: "string" },
              },
              required: ["note_id", "markdown"],
              type: "object",
            },
          },
        ],
      }),
    ).resolves.toEqual({
      functionCalls: [
        {
          arguments:
            '{"markdown":"# Note modifiée\\n\\nContenu.","note_id":"note-1"}',
          callId: "call-1",
          name: "replace_linked_note",
        },
      ],
      text: "",
    });

    const body = JSON.parse(
      String(vi.mocked(fetch).mock.calls[0]?.[1]?.body),
    ) as { tool_choice?: unknown; tools?: unknown };
    expect(body.tool_choice).toBe("required");
    expect(body.tools).toEqual([
      {
        description: "Remplace une note liée.",
        name: "replace_linked_note",
        parameters: expect.objectContaining({
          additionalProperties: false,
          required: ["note_id", "markdown"],
        }),
        strict: true,
        type: "function",
      },
    ]);
  });

  it("reads a local tool call from a streamed ChatGPT subscription response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            [
              "event: response.function_call_arguments.done",
              'data: {"type":"response.function_call_arguments.done","call_id":"call-stream-1","name":"create_note","arguments":"{\\\"markdown\\\":\\\"# Brouillon\\\"}"}',
              "",
              "event: response.completed",
              'data: {"type":"response.completed"}',
              "",
            ].join("\n"),
            { headers: { "content-type": "text/event-stream" }, status: 200 },
          ),
        ),
    );

    await expect(
      completeCodexAgent({
        instructions: "Utilise un outil local.",
        messages: [{ content: "Crée une note.", role: "user" }],
        model: "gpt-5.6-luna",
        token,
        toolChoice: "required",
        tools: [
          {
            description: "Crée une note.",
            name: "create_note",
            parameters: {
              additionalProperties: false,
              properties: { markdown: { type: "string" } },
              required: ["markdown"],
              type: "object",
            },
          },
        ],
        transport: "chatgpt",
      }),
    ).resolves.toEqual({
      functionCalls: [
        {
          arguments: '{"markdown":"# Brouillon"}',
          callId: "call-stream-1",
          name: "create_note",
        },
      ],
      text: "",
    });
  });

  it("rejects conflicting streamed calls sharing a call id", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            [
              "event: response.function_call_arguments.done",
              'data: {"type":"response.function_call_arguments.done","call_id":"call-stream-2","name":"create_note","arguments":"{\\\"value\\\":\\\"first\\\"}"}',
              "",
              "event: response.function_call_arguments.done",
              'data: {"type":"response.function_call_arguments.done","call_id":"call-stream-2","name":"create_note","arguments":"{\\\"value\\\":\\\"second\\\"}"}',
              "",
              "event: response.completed",
              'data: {"type":"response.completed"}',
              "",
            ].join("\n"),
            { headers: { "content-type": "text/event-stream" }, status: 200 },
          ),
        ),
    );

    await expect(
      completeCodexAgent({
        instructions: "Utilise un outil local.",
        messages: [{ content: "Effectue une action.", role: "user" }],
        model: "gpt-5.6-luna",
        token,
        transport: "chatgpt",
      }),
    ).rejects.toThrow("L’assistant a fourni plusieurs actions.");
  });

  it("does not leak the token or note content in thrown errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: `Invalid token ${token} for note # Secret diary`,
            },
          }),
          { status: 401 },
        ),
      ),
    );

    await expect(
      completeCodexChat({
        instructions: "x",
        messages: [{ content: "# Secret diary", role: "user" }],
        model: "gpt-5.6-sol",
        token,
      }),
    ).rejects.toThrow("Clé ou jeton refusé par le fournisseur.");

    try {
      await completeCodexChat({
        instructions: "x",
        messages: [{ content: "# Secret diary", role: "user" }],
        model: "gpt-5.6-sol",
        token,
      });
    } catch (error) {
      const serialized = JSON.stringify(
        error,
        Object.getOwnPropertyNames(error),
      );
      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain("Secret diary");
    }
  });

  it("maps a network failure without echoing the credential", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError(`Failed to fetch ${token}`)),
    );

    await expect(
      completeCodexChat({
        instructions: "x",
        messages: [{ content: "hello", role: "user" }],
        model: "gpt-5.6-sol",
        token,
      }),
    ).rejects.toThrow("Impossible de joindre l’assistant.");
  });

  it("sends ChatGPT subscription requests as a Codex SSE stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            "event: response.output_text.delta",
            'data: {"type":"response.output_text.delta","delta":"Brouillon "}',
            "",
            "event: response.output_text.delta",
            'data: {"type":"response.output_text.delta","delta":"abo."}',
            "",
            "event: response.completed",
            'data: {"type":"response.completed","response":{"output_text":"Brouillon abo."}}',
            "",
          ].join("\n"),
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        ),
      ),
    );

    await expect(
      completeCodexChat({
        accountId: "acct-42",
        instructions: "Rédige du Markdown.",
        messages: [{ content: "Écris.", role: "user" }],
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        serviceTier: "fast",
        token,
        transport: "chatgpt",
      }),
    ).resolves.toBe("Brouillon abo.");

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`,
        "ChatGPT-Account-ID": "acct-42",
        "OpenAI-Beta": "responses=experimental",
        originator: "codex_cli_rs",
        version: CODEX_CLIENT_VERSION,
      }),
    );
    const body = JSON.parse(String(init?.body)) as {
      input: unknown;
      reasoning?: unknown;
      service_tier?: unknown;
      store: boolean;
      stream: boolean;
    };
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.service_tier).toBe("fast");
    expect(body.input).toEqual([
      {
        content: [{ text: "Écris.", type: "input_text" }],
        role: "user",
        type: "message",
      },
    ]);
  });

  it("lists ChatGPT Codex models without sending notes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
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
                  { description: "Maximum", effort: "xhigh" },
                ],
                visibility: "list",
              },
              {
                additional_speed_tiers: ["fast"],
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
              {
                display_name: "Hidden engine",
                slug: "internal-engine",
                visibility: "none",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      listCodexModels({
        accountId: "acct-42",
        token,
        transport: "chatgpt",
      }),
    ).resolves.toEqual([
      {
        defaultReasoningLevel: "medium",
        id: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        reasoningLevels: [
          { id: "low", label: "Faster" },
          { id: "medium", label: "Balanced" },
          { id: "high", label: "Deeper" },
          { id: "xhigh", label: "Maximum" },
        ],
        serviceTiers: [
          { description: "Priority processing.", id: "fast", name: "Fast" },
        ],
      },
      {
        id: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
        reasoningLevels: [],
        serviceTiers: [{ description: "", id: "fast", name: "fast" }],
      },
      {
        id: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        reasoningLevels: [],
        serviceTiers: [],
      },
    ]);
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe(
      `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLIENT_VERSION}`,
    );
    expect(init?.headers).toEqual(
      expect.objectContaining({
        originator: "codex_cli_rs",
        version: CODEX_CLIENT_VERSION,
      }),
    );
  });

  it("does not substitute a hardcoded catalog when Codex returns none", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ models: [] }), { status: 200 }),
        ),
    );

    await expect(
      listCodexModels({ token, transport: "chatgpt" }),
    ).rejects.toThrow("Aucun modèle n’est disponible pour l’assistant.");
  });
});

describe("completeCodexAgent over chat completions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const baseUrl = "https://open.bigmodel.cn/api/paas/v4";

  function chatCompletionsToolCallResponse(toolCalls: unknown[]) {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: { content: "", role: "assistant", tool_calls: toolCalls },
          },
        ],
      }),
      { status: 200 },
    );
  }

  it("disables parallel tool calls and maps tool calls for OpenAI-compatible providers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        chatCompletionsToolCallResponse([
          {
            function: {
              arguments: '{"markdown":"# Note GLM"}',
              name: "create_note",
            },
            id: "call-glm-1",
            type: "function",
          },
        ]),
      ),
    );

    const response = await completeCodexAgent({
      baseUrl,
      instructions: "Choisis un outil d’écriture.",
      messages: [{ content: "Crée une note.", role: "user" }],
      model: "glm-4.6",
      token,
      toolChoice: "required",
      tools: [
        {
          description: "Crée une note.",
          name: "create_note",
          parameters: { type: "object" },
        },
      ],
    });

    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/chat/completions`,
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(
      String(vi.mocked(fetch).mock.calls[0]?.[1]?.body),
    ) as {
      parallel_tool_calls?: boolean;
      tool_choice?: string;
      tools?: Array<{ function?: { name?: string }; type?: string }>;
    };
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.tool_choice).toBe("required");
    expect(body.tools?.[0]?.type).toBe("function");
    expect(body.tools?.[0]?.function?.name).toBe("create_note");
    expect(response.functionCalls).toHaveLength(1);
    expect(response.functionCalls[0]?.name).toBe("create_note");
    expect(response.functionCalls[0]?.arguments).toBe(
      '{"markdown":"# Note GLM"}',
    );
  });

  it("rejects several tool calls with a fixed local error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        chatCompletionsToolCallResponse([
          {
            function: {
              arguments: '{"markdown":"# Première"}',
              name: "create_note",
            },
            id: "call-glm-2",
            type: "function",
          },
          {
            function: {
              arguments: '{"markdown":"# Deuxième"}',
              name: "create_note",
            },
            id: "call-glm-3",
            type: "function",
          },
        ]),
      ),
    );

    await expect(
      completeCodexAgent({
        baseUrl,
        instructions: "Choisis un outil d’écriture.",
        messages: [{ content: "Crée deux notes.", role: "user" }],
        model: "glm-4.6",
        token,
        toolChoice: "required",
      }),
    ).rejects.toThrow("L’assistant a fourni plusieurs actions.");
  });

  it("rejects tool calls from a non-assistant chat completions message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "",
                  role: "user",
                  tool_calls: [
                    {
                      function: { arguments: "{}", name: "create_note" },
                      id: "call-user-1",
                      type: "function",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      completeCodexAgent({
        baseUrl,
        instructions: "Utilise un outil local.",
        messages: [{ content: "Effectue une action.", role: "user" }],
        model: "glm-4.6",
        token,
        toolChoice: "required",
      }),
    ).rejects.toThrow("L’assistant n’a pas pu répondre.");
  });

  it("rejects a malformed tool call mixed with a valid call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        chatCompletionsToolCallResponse([
          {
            function: {
              arguments: "{}",
              name: "create_note",
            },
            id: "call-valid",
            type: "function",
          },
          {
            function: {},
            id: "call-incomplete",
            type: "function",
          },
        ]),
      ),
    );

    await expect(
      completeCodexAgent({
        baseUrl,
        instructions: "Utilise un outil local.",
        messages: [{ content: "Effectue une action.", role: "user" }],
        model: "glm-4.6",
        token,
        toolChoice: "required",
      }),
    ).rejects.toThrow("L’assistant n’a pas pu répondre.");
  });

  it.each([
    { choices: ["not a choice"] },
    { choices: [{ message: ["not a message"] }] },
  ])(
    "rejects a malformed chat completions choice envelope",
    async (responseBody) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify(responseBody), { status: 200 }),
          ),
      );

      await expect(
        completeCodexAgent({
          baseUrl,
          instructions: "Réponds brièvement.",
          messages: [{ content: "Question.", role: "user" }],
          model: "glm-4.6",
          token,
        }),
      ).rejects.toThrow("L’assistant n’a pas pu répondre.");
    },
  );

  it("rejects text mixed with a local tool call from OpenAI-compatible providers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "Une action est prête.",
                  role: "assistant",
                  tool_calls: [
                    {
                      function: { arguments: "{}", name: "create_note" },
                      id: "call-mixed-1",
                      type: "function",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      completeCodexAgent({
        baseUrl,
        instructions: "Utilise un outil local.",
        messages: [{ content: "Effectue une action.", role: "user" }],
        model: "glm-4.6",
        token,
        toolChoice: "required",
      }),
    ).rejects.toThrow("L’assistant n’a pas pu répondre.");
  });

  it("rejects ambiguous choices from OpenAI-compatible providers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: "Réponse alternative." } },
              { message: { tool_calls: [{}] } },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      completeCodexAgent({
        baseUrl,
        instructions: "Réponds brièvement.",
        messages: [{ content: "Question.", role: "user" }],
        model: "glm-4.6",
        token,
      }),
    ).rejects.toThrow("L’assistant n’a pas pu répondre.");
  });
});
