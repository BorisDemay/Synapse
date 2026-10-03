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

  it("reads a JSON Responses output_text containing an SSE marker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            output_text: "Le marqueur littéral data: reste du texte.",
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      ),
    );

    await expect(
      completeCodexChat({
        instructions: "Réponds brièvement.",
        messages: [{ content: "Quel est ce marqueur ?", role: "user" }],
        model: "gpt-5.6-luna",
        token,
      }),
    ).resolves.toBe("Le marqueur littéral data: reste du texte.");
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

  it.each([
    { label: "null", outputText: null },
    { label: "number", outputText: 42 },
    {
      label: "object",
      outputText: { providerFixture: "provider-fixture-output-text" },
    },
    { label: "array", outputText: ["provider-fixture-output-text"] },
  ])(
    "rejects a JSON or completed SSE Responses $label output_text before returning a local tool call",
    async ({ outputText }) => {
      const functionCall = {
        arguments: '{"markdown":"# Brouillon"}',
        call_id: "call-valid-output-text-type",
        name: "create_note",
        type: "function_call",
      };
      const responses = [
        new Response(
          JSON.stringify({ output: [functionCall], output_text: outputText }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
        new Response(
          [
            {
              ...functionCall,
              type: "response.function_call_arguments.done",
            },
            { output_text: outputText, type: "response.completed" },
          ]
            .map((event) => `data: ${JSON.stringify(event)}`)
            .join("\n\n"),
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        ),
      ];

      for (const response of responses) {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
        let result: unknown;
        let thrown: unknown;

        try {
          result = await completeCodexAgent({
            instructions: "Utilise un outil local.",
            messages: [{ content: "Crée une note.", role: "user" }],
            model: "gpt-5.6-luna",
            token,
            toolChoice: "required",
            tools: [
              {
                description: "Crée une note locale.",
                name: "create_note",
                parameters: {
                  additionalProperties: false,
                  properties: { markdown: { type: "string" } },
                  required: ["markdown"],
                  type: "object",
                },
              },
            ],
          });
        } catch (error) {
          thrown = error;
        }

        expect(result).toBeUndefined();
        expect(thrown).toMatchObject({
          message: "L’assistant n’a pas pu répondre.",
        });
        expect(String(thrown)).toBe("Error: L’assistant n’a pas pu répondre.");
        expect(JSON.stringify(thrown)).not.toContain(
          "provider-fixture-output-text",
        );
      }
    },
  );

  it.each([
    { label: "object", output: {} },
    { label: "null", output: null },
    { label: "string", output: "not-an-output-array" },
  ])(
    "rejects a JSON Responses $label output before returning an agent response",
    async ({ output }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({ output, output_text: "Ignore this." }),
            {
              headers: { "content-type": "application/json" },
              status: 200,
            },
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
        }),
      ).rejects.toThrow("L’assistant n’a pas pu répondre.");
    },
  );

  it.each([
    { label: "object", output: {} },
    { label: "null", output: null },
    { label: "string", output: "not-an-output-array" },
  ])(
    "rejects a completed SSE Responses $label output after a valid local tool call",
    async ({ output }) => {
      const validCall = {
        arguments: '{"markdown":"# Brouillon"}',
        call_id: "call-before-malformed-completed-output",
        name: "create_note",
        type: "response.function_call_arguments.done",
      };
      const completed = {
        response: { output, output_text: "Ignore this." },
        type: "response.completed",
      };
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              [validCall, completed]
                .map((event) => `data: ${JSON.stringify(event)}`)
                .join("\n\n"),
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
        }),
      ).rejects.toThrow("L’assistant n’a pas pu répondre.");
    },
  );

  it("accepts array Responses output in JSON and response.completed SSE flows", async () => {
    const functionCall = {
      arguments: '{"markdown":"# Brouillon"}',
      call_id: "call-valid-array-output",
      name: "create_note",
      type: "function_call",
    };
    const responses = [
      new Response(
        JSON.stringify({
          output: [
            {
              content: [{ text: "Brouillon JSON.", type: "output_text" }],
              role: "assistant",
              type: "message",
            },
          ],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
      new Response(
        `data: ${JSON.stringify({
          response: { output: [functionCall] },
          type: "response.completed",
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      ),
    ];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(responses[0]));
    await expect(
      completeCodexAgent({
        instructions: "Utilise un outil local.",
        messages: [{ content: "Rédige.", role: "user" }],
        model: "gpt-5.6-luna",
        token,
      }),
    ).resolves.toEqual({ functionCalls: [], text: "Brouillon JSON." });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(responses[1]));
    await expect(
      completeCodexAgent({
        instructions: "Utilise un outil local.",
        messages: [{ content: "Crée une note.", role: "user" }],
        model: "gpt-5.6-luna",
        token,
        toolChoice: "required",
      }),
    ).resolves.toEqual({
      functionCalls: [
        {
          arguments: '{"markdown":"# Brouillon"}',
          callId: "call-valid-array-output",
          name: "create_note",
        },
      ],
      text: "",
    });
  });

  it.each([
    { item: null, label: "null" },
    { item: "not-an-output-item", label: "string" },
    { item: 42, label: "number" },
    { item: [], label: "array" },
  ])(
    "rejects a JSON or completed SSE Responses $label output item before returning a local tool call",
    async ({ item }) => {
      const validCall = {
        arguments: '{"markdown":"# Brouillon"}',
        call_id: "call-after-malformed-output-item",
        name: "create_note",
        type: "function_call",
      };
      const responses = [
        new Response(JSON.stringify({ output: [item, validCall] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
        new Response(
          `data: ${JSON.stringify({
            response: { output: [item, validCall] },
            type: "response.completed",
          })}\n\n`,
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        ),
      ];

      for (const response of responses) {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

        await expect(
          completeCodexAgent({
            instructions: "Utilise un outil local.",
            messages: [{ content: "Crée une note.", role: "user" }],
            model: "gpt-5.6-luna",
            token,
            toolChoice: "required",
          }),
        ).rejects.toMatchObject({
          message: "L’assistant n’a pas pu répondre.",
        });
      }
    },
  );

  it("rejects a message Responses item with a non-assistant role before a valid local tool call in every flow without exposing its fixture", async () => {
    const message = { content: [], role: "user" };
    const providerFixture = "provider-malformed-message-role-fixture";
    const functionCall = {
      arguments: JSON.stringify({ value: providerFixture }),
      call_id: "call-after-malformed-message-role",
      name: "create_note",
      type: "function_call",
    };
    const responses = [
      new Response(
        JSON.stringify({
          output: [{ ...message, type: "message" }, functionCall],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
      new Response(
        [
          {
            item: { ...message, type: "message" },
            type: "response.output_item.done",
          },
          { ...functionCall, type: "response.function_call_arguments.done" },
        ]
          .map((event) => `data: ${JSON.stringify(event)}`)
          .join("\n\n"),
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      ),
      new Response(
        [
          {
            item: { ...message, type: "message" },
            type: "response.output_item.added",
          },
          { ...functionCall, type: "response.function_call_arguments.done" },
        ]
          .map((event) => `data: ${JSON.stringify(event)}`)
          .join("\n\n"),
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      ),
      new Response(
        `data: ${JSON.stringify({
          response: {
            output: [{ ...message, type: "message" }, functionCall],
          },
          type: "response.completed",
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      ),
    ];

    for (const response of responses) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      let result: Awaited<ReturnType<typeof completeCodexAgent>> | undefined;
      const error = await completeCodexAgent({
        instructions: "Utilise un outil local.",
        messages: [{ content: "Crée une note.", role: "user" }],
        model: "gpt-5.6-luna",
        token,
        toolChoice: "required",
        tools: [
          {
            description: "Crée une note.",
            name: "create_note",
            parameters: { type: "object" },
          },
        ],
      })
        .then((agentResponse) => {
          result = agentResponse;
          return undefined;
        })
        .catch((reason: unknown) => reason);

      expect(result).toBeUndefined();
      expect(error).toMatchObject({
        message: "L’assistant n’a pas pu répondre.",
      });
      const serialized = JSON.stringify(
        error,
        Object.getOwnPropertyNames(error as Error),
      );
      expect(String(error)).not.toContain(providerFixture);
      expect(serialized).not.toContain(providerFixture);
    }
  });

  it("accepts a Responses message without an explicit role before a valid local tool call", async () => {
    const functionCall = {
      arguments: '{"value":"fixture-safe"}',
      call_id: "call-after-roleless-message",
      name: "create_note",
      type: "function_call",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ output: [{ type: "message" }, functionCall] }),
            { headers: { "content-type": "application/json" }, status: 200 },
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
      }),
    ).resolves.toMatchObject({
      functionCalls: [{ callId: "call-after-roleless-message" }],
    });
  });

  it("rejects completed SSE output items even when the event includes output_text", async () => {
    const validCall = {
      arguments: '{"markdown":"# Brouillon"}',
      call_id: "call-before-completed-output-text",
      name: "create_note",
      type: "response.function_call_arguments.done",
    };
    const completed = {
      output_text: "Réponse finale.",
      response: { output: [null] },
      type: "response.completed",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            [validCall, completed]
              .map((event) => `data: ${JSON.stringify(event)}`)
              .join("\n\n"),
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
      }),
    ).rejects.toMatchObject({
      message: "L’assistant n’a pas pu répondre.",
    });
  });

  it.each([
    { label: "null", response: null },
    { label: "string", response: "not-a-response-object" },
    { label: "number", response: 42 },
    { label: "boolean", response: false },
    { label: "array", response: [] },
  ])(
    "rejects a completed SSE $label response envelope before returning a valid local tool call",
    async ({ response }) => {
      const validCall = {
        arguments: '{"markdown":"# Brouillon"}',
        call_id: "call-before-malformed-completed-response",
        name: "create_note",
        type: "response.function_call_arguments.done",
      };
      const completed = {
        output_text: "Réponse finale.",
        response,
        type: "response.completed",
      };
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              [validCall, completed]
                .map((event) => `data: ${JSON.stringify(event)}`)
                .join("\n\n"),
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
        }),
      ).rejects.toMatchObject({
        message: "L’assistant n’a pas pu répondre.",
      });
    },
  );

  it.each([
    { content: {}, label: "object" },
    { content: "not-an-output-content-array", label: "string" },
    { content: null, label: "null" },
    { content: [null], label: "array containing null" },
    {
      content: ["not-an-output-content-item"],
      label: "array containing string",
    },
    { content: [[]], label: "array containing array" },
  ])(
    "rejects a JSON or completed SSE message with $label content before returning a local tool call",
    async ({ content }) => {
      const functionCall = {
        arguments: '{"markdown":"# Brouillon"}',
        call_id: "call-after-malformed-message-content",
        name: "create_note",
        type: "function_call",
      };
      const output = [{ content, type: "message" }, functionCall];
      const responses = [
        new Response(JSON.stringify({ output }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
        new Response(
          `data: ${JSON.stringify({
            response: { output },
            type: "response.completed",
          })}\n\n`,
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        ),
      ];

      for (const response of responses) {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

        await expect(
          completeCodexAgent({
            instructions: "Utilise un outil local.",
            messages: [{ content: "Crée une note.", role: "user" }],
            model: "gpt-5.6-luna",
            token,
            toolChoice: "required",
          }),
        ).rejects.toMatchObject({
          message: "L’assistant n’a pas pu répondre.",
        });
      }
    },
  );

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

  it("reads a local tool call from CRLF-framed ChatGPT subscription events", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            [
              "event: response.function_call_arguments.done",
              'data: {"type":"response.function_call_arguments.done","call_id":"call-crlf-1","name":"create_note","arguments":"{\\\"markdown\\\":\\\"# Brouillon CRLF\\\"}"}',
              "",
              "event: response.completed",
              'data: {"type":"response.completed"}',
              "",
            ].join("\r\n"),
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
            parameters: { type: "object" },
          },
        ],
        transport: "chatgpt",
      }),
    ).resolves.toEqual({
      functionCalls: [
        {
          arguments: '{"markdown":"# Brouillon CRLF"}',
          callId: "call-crlf-1",
          name: "create_note",
        },
      ],
      text: "",
    });
  });

  it("reads a local tool call from CR-only ChatGPT subscription events", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            [
              "event: response.function_call_arguments.done",
              'data: {"type":"response.function_call_arguments.done","call_id":"call-cr-1","name":"create_note","arguments":"{\\\"markdown\\\":\\\"# Brouillon CR\\\"}"}',
              "",
              "event: response.completed",
              'data: {"type":"response.completed"}',
              "",
            ].join("\r"),
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
            parameters: { type: "object" },
          },
        ],
        transport: "chatgpt",
      }),
    ).resolves.toEqual({
      functionCalls: [
        {
          arguments: '{"markdown":"# Brouillon CR"}',
          callId: "call-cr-1",
          name: "create_note",
        },
      ],
      text: "",
    });
  });

  it("reads an official Responses tool completion only from its final output item", async () => {
    const argumentsValue = '{"markdown":"# Brouillon officiel"}';
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            {
              arguments: argumentsValue,
              item_id: "item-official-tool-call",
              output_index: 0,
              type: "response.function_call_arguments.done",
            },
            {
              item: {
                arguments: argumentsValue,
                call_id: "call-official-tool-call",
                id: "item-official-tool-call",
                name: "create_note",
                type: "function_call",
              },
              output_index: 0,
              type: "response.output_item.done",
            },
          ]
            .map((event) => `data: ${JSON.stringify(event)}`)
            .join("\n\n"),
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
            parameters: { type: "object" },
          },
        ],
        transport: "chatgpt",
      }),
    ).resolves.toEqual({
      functionCalls: [
        {
          arguments: argumentsValue,
          callId: "call-official-tool-call",
          name: "create_note",
        },
      ],
      text: "",
    });
  });

  it("reads an official Responses tool completion from a matching response.completed item", async () => {
    const argumentsValue = '{"markdown":"# Brouillon officiel terminé"}';
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            {
              arguments: argumentsValue,
              item_id: "item-official-completed-tool-call",
              output_index: 0,
              type: "response.function_call_arguments.done",
            },
            {
              response: {
                output: [
                  {
                    arguments: argumentsValue,
                    call_id: "call-official-completed-tool-call",
                    id: "item-official-completed-tool-call",
                    name: "create_note",
                    type: "function_call",
                  },
                ],
              },
              type: "response.completed",
            },
          ]
            .map((event) => `data: ${JSON.stringify(event)}`)
            .join("\n\n"),
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
            parameters: { type: "object" },
          },
        ],
        transport: "chatgpt",
      }),
    ).resolves.toEqual({
      functionCalls: [
        {
          arguments: argumentsValue,
          callId: "call-official-completed-tool-call",
          name: "create_note",
        },
      ],
      text: "",
    });
  });

  it.each([
    {
      finalEvents: (functionCall: Record<string, unknown>) => [
        {
          item: functionCall,
          output_index: 0,
          type: "response.output_item.done",
        },
        {
          item: functionCall,
          output_index: 0,
          type: "response.output_item.done",
        },
      ],
      label: "response.output_item.done",
    },
    {
      finalEvents: (functionCall: Record<string, unknown>) => [
        { response: { output: [functionCall] }, type: "response.completed" },
        { response: { output: [functionCall] }, type: "response.completed" },
      ],
      label: "response.completed",
    },
  ])(
    "deduplicates repeated correlated official Responses $label finals",
    async ({ finalEvents }) => {
      const functionCall = {
        arguments: '{"markdown":"# Brouillon officiel répété"}',
        call_id: "call-official-repeated-final",
        id: "item-official-repeated-final",
        name: "create_note",
        type: "function_call",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            [
              {
                arguments: functionCall.arguments,
                item_id: functionCall.id,
                output_index: 0,
                type: "response.function_call_arguments.done",
              },
              ...finalEvents(functionCall),
            ]
              .map((event) => `data: ${JSON.stringify(event)}`)
              .join("\n\n"),
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
              parameters: { type: "object" },
            },
          ],
          transport: "chatgpt",
        }),
      ).resolves.toEqual({
        functionCalls: [
          {
            arguments: functionCall.arguments,
            callId: functionCall.call_id,
            name: functionCall.name,
          },
        ],
        text: "",
      });
    },
  );

  it.each([
    {
      arguments: '{"markdown":"# Brouillon officiel"}',
      itemId: "item-official-mismatched-final",
      label: "item identifier",
      outputIndex: 0,
    },
    {
      arguments: '{"markdown":"# Brouillon officiel"}',
      itemId: "item-official-partial",
      label: "output index",
      outputIndex: 1,
    },
    {
      arguments: '{"markdown":"provider-official-mismatched-final-fixture"}',
      itemId: "item-official-partial",
      label: "arguments",
      outputIndex: 0,
    },
  ])(
    "rejects an official Responses final item with a mismatched $label without exposing its fixture",
    async ({ arguments: argumentsValue, itemId, outputIndex }) => {
      const providerFixture = "provider-official-mismatched-final-fixture";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            [
              {
                arguments: '{"markdown":"# Brouillon officiel"}',
                item_id: "item-official-partial",
                output_index: 0,
                type: "response.function_call_arguments.done",
              },
              {
                item: {
                  arguments: argumentsValue,
                  call_id: "call-official-mismatched-final",
                  id: itemId,
                  name: "create_note",
                  type: "function_call",
                },
                output_index: outputIndex,
                type: "response.output_item.done",
              },
            ]
              .map((event) => `data: ${JSON.stringify(event)}`)
              .join("\n\n"),
            { headers: { "content-type": "text/event-stream" }, status: 200 },
          ),
        ),
      );

      let result: Awaited<ReturnType<typeof completeCodexAgent>> | undefined;
      const error = await completeCodexAgent({
        instructions: "Utilise un outil local.",
        messages: [{ content: "Crée une note.", role: "user" }],
        model: "gpt-5.6-luna",
        token,
        toolChoice: "required",
        tools: [
          {
            description: "Crée une note.",
            name: "create_note",
            parameters: { type: "object" },
          },
        ],
        transport: "chatgpt",
      })
        .then((agentResponse) => {
          result = agentResponse;
          return undefined;
        })
        .catch((reason: unknown) => reason);

      expect(result).toBeUndefined();
      expect(error).toMatchObject({
        message: "L’assistant n’a pas pu répondre.",
      });
      expect(String(error)).toBe("Error: L’assistant n’a pas pu répondre.");
      const serialized = JSON.stringify(
        error,
        Object.getOwnPropertyNames(error as Error),
      );
      expect(String(error)).not.toContain(providerFixture);
      expect(serialized).not.toContain(providerFixture);
    },
  );

  it.each([
    {
      arguments: '["provider-official-invalid-arguments-fixture"]',
      itemId: "item-official-invalid",
      label: "non-object arguments",
      outputIndex: 0,
    },
    {
      arguments: '{"markdown":"# Brouillon"}',
      itemId: undefined,
      label: "a missing item id",
      outputIndex: 0,
    },
    {
      arguments: '{"markdown":"# Brouillon"}',
      itemId: "",
      label: "a blank item id",
      outputIndex: 0,
    },
    {
      arguments: '{"markdown":"# Brouillon"}',
      itemId: "item-official-invalid",
      label: "a negative output index",
      outputIndex: -1,
    },
    {
      arguments: '{"markdown":"# Brouillon"}',
      itemId: "item-official-invalid",
      label: "a non-integer output index",
      outputIndex: 0.5,
    },
  ])(
    "rejects an official Responses tool completion with $label without exposing the provider fixture",
    async ({ arguments: argumentsValue, itemId, outputIndex }) => {
      const providerFixture = "provider-official-invalid-arguments-fixture";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            [
              {
                arguments: argumentsValue,
                item_id: itemId,
                output_index: outputIndex,
                type: "response.function_call_arguments.done",
              },
              {
                item: {
                  arguments: '{"markdown":"# Brouillon"}',
                  call_id: "call-official-invalid",
                  name: "create_note",
                  type: "function_call",
                },
                type: "response.output_item.done",
              },
            ]
              .map((event) => `data: ${JSON.stringify(event)}`)
              .join("\n\n"),
            { headers: { "content-type": "text/event-stream" }, status: 200 },
          ),
        ),
      );

      let result: Awaited<ReturnType<typeof completeCodexAgent>> | undefined;
      const error = await completeCodexAgent({
        instructions: "Utilise un outil local.",
        messages: [{ content: "Crée une note.", role: "user" }],
        model: "gpt-5.6-luna",
        token,
        toolChoice: "required",
        tools: [
          {
            description: "Crée une note.",
            name: "create_note",
            parameters: { type: "object" },
          },
        ],
        transport: "chatgpt",
      })
        .then((agentResponse) => {
          result = agentResponse;
          return undefined;
        })
        .catch((reason: unknown) => reason);

      expect(result).toBeUndefined();
      expect(error).toMatchObject({
        message: "L’assistant n’a pas pu répondre.",
      });
      const serialized = JSON.stringify(
        error,
        Object.getOwnPropertyNames(error as Error),
      );
      expect(String(error)).not.toContain(providerFixture);
      expect(serialized).not.toContain(providerFixture);
    },
  );

  it.each([
    {
      arguments: "provider-official-invalid-final-arguments-fixture",
      label: "invalid arguments",
      name: "create_note",
    },
    {
      arguments: '{"markdown":"# Brouillon"}',
      label: "an unoffered tool",
      name: "provider-official-unoffered-tool-fixture",
    },
  ])(
    "rejects an official Responses tool completion with $label in the final item without exposing the provider fixture",
    async ({ arguments: argumentsValue, name }) => {
      const providerFixture = String(
        argumentsValue === "provider-official-invalid-final-arguments-fixture"
          ? argumentsValue
          : name,
      );
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            [
              {
                arguments: '{"markdown":"# Brouillon"}',
                item_id: "item-official-invalid-final",
                output_index: 0,
                type: "response.function_call_arguments.done",
              },
              {
                item: {
                  arguments: argumentsValue,
                  call_id: "call-official-invalid-final",
                  name,
                  type: "function_call",
                },
                type: "response.output_item.done",
              },
            ]
              .map((event) => `data: ${JSON.stringify(event)}`)
              .join("\n\n"),
            { headers: { "content-type": "text/event-stream" }, status: 200 },
          ),
        ),
      );

      let result: Awaited<ReturnType<typeof completeCodexAgent>> | undefined;
      const error = await completeCodexAgent({
        instructions: "Utilise un outil local.",
        messages: [{ content: "Crée une note.", role: "user" }],
        model: "gpt-5.6-luna",
        token,
        toolChoice: "required",
        tools: [
          {
            description: "Crée une note.",
            name: "create_note",
            parameters: { type: "object" },
          },
        ],
        transport: "chatgpt",
      })
        .then((agentResponse) => {
          result = agentResponse;
          return undefined;
        })
        .catch((reason: unknown) => reason);

      expect(result).toBeUndefined();
      expect(error).toMatchObject({
        message: "L’assistant n’a pas pu répondre.",
      });
      const serialized = JSON.stringify(
        error,
        Object.getOwnPropertyNames(error as Error),
      );
      expect(String(error)).not.toContain(providerFixture);
      expect(serialized).not.toContain(providerFixture);
    },
  );

  it("rejects a streamed ChatGPT response that combines an authorized local tool call and text", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            [
              'data: {"type":"response.function_call_arguments.done","call_id":"call-mixed-stream","name":"create_note","arguments":"{\\\"markdown\\\":\\\"# Brouillon\\\"}"}',
              'data: {"type":"response.output_text.delta","delta":"Texte non blanc."}',
              'data: {"type":"response.completed"}',
            ].join("\n\n"),
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
    ).rejects.toMatchObject({
      message: "L’assistant n’a pas pu répondre.",
    });
  });

  it("rejects streamed Responses output items that combine an authorized local tool call and text", async () => {
    const functionCall = {
      arguments: '{"markdown":"# Brouillon"}',
      call_id: "call-mixed-output-items",
      name: "create_note",
      type: "function_call",
    };
    const message = {
      content: [{ text: "Texte non blanc.", type: "output_text" }],
      type: "message",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [functionCall, message]
            .map((item) =>
              JSON.stringify({ item, type: "response.output_item.done" }),
            )
            .map((event) => `data: ${event}`)
            .join("\n\n"),
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
    ).rejects.toMatchObject({
      message: "L’assistant n’a pas pu répondre.",
    });
  });

  it.each([
    {
      event: { text: "Texte non blanc.", type: "response.output_text.done" },
      label: "output_text.done",
    },
    {
      event: {
        part: { text: "Texte non blanc.", type: "output_text" },
        type: "response.content_part.added",
      },
      label: "content_part.added",
    },
    {
      event: {
        part: { text: "Texte non blanc.", type: "output_text" },
        type: "response.content_part.done",
      },
      label: "content_part.done",
    },
  ])(
    "rejects a streamed Responses $label event mixed with an authorized local tool call",
    async ({ event }) => {
      const functionCall = {
        arguments: '{"markdown":"# Brouillon"}',
        call_id: "call-mixed-streamed-response-text",
        name: "create_note",
        type: "response.function_call_arguments.done",
      };
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              [functionCall, event]
                .map((item) => `data: ${JSON.stringify(item)}`)
                .join("\n\n"),
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
      ).rejects.toMatchObject({
        message: "L’assistant n’a pas pu répondre.",
      });
    },
  );
  it.each([
    { contentType: "text/event-stream", label: "an SSE content type" },
    { contentType: "application/json", label: "an SSE body" },
  ])(
    "rejects an invalid SSE frame before a valid local tool call detected from $label",
    async ({ contentType }) => {
      const validCall = {
        arguments: '{"markdown":"# Brouillon"}',
        call_id: "call-valid-after-malformed-frame",
        name: "create_note",
        type: "response.function_call_arguments.done",
      };
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              ["data: not-json", `data: ${JSON.stringify(validCall)}`].join(
                "\n\n",
              ),
              { headers: { "content-type": contentType }, status: 200 },
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
        }),
      ).rejects.toThrow("L’assistant n’a pas pu répondre.");
    },
  );

  it.each([
    { label: "null", payload: null },
    { label: "an array", payload: [] },
    { label: "a string", payload: "not an event object" },
  ])(
    "rejects structurally invalid SSE JSON $label before a valid local tool call",
    async ({ payload }) => {
      const validCall = {
        arguments: '{"markdown":"# Brouillon"}',
        call_id: "call-valid-after-invalid-json-structure",
        name: "create_note",
        type: "response.function_call_arguments.done",
      };
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              [
                `data: ${JSON.stringify(payload)}`,
                `data: ${JSON.stringify(validCall)}`,
              ].join("\n\n"),
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
        }),
      ).rejects.toThrow("L’assistant n’a pas pu répondre.");
    },
  );

  it.each([
    { label: "absent" },
    { item: null, label: "null" },
    { item: "not-an-output-item", label: "string" },
    { item: 42, label: "number" },
    { item: [], label: "array" },
  ])(
    "rejects a $label output item before a valid local tool call",
    async ({ item }) => {
      const malformedEvent: Record<string, unknown> = {
        type: "response.output_item.done",
      };
      if (item !== undefined) {
        malformedEvent.item = item;
      }
      const validCall = {
        arguments: '{"markdown":"# Brouillon"}',
        call_id: "call-valid-after-malformed-output-item",
        name: "create_note",
        type: "response.function_call_arguments.done",
      };
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              [malformedEvent, validCall]
                .map((event) => `data: ${JSON.stringify(event)}`)
                .join("\n\n"),
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
        }),
      ).rejects.toMatchObject({
        message: "L’assistant n’a pas pu répondre.",
      });
    },
  );

  it("rejects a message output item with text before a valid local tool call", async () => {
    const messageItem = {
      content: [{ text: "Je prépare la note.", type: "output_text" }],
      role: "assistant",
      type: "message",
    };
    const validCall = {
      arguments: '{"markdown":"# Brouillon"}',
      call_id: "call-after-message-output-item",
      name: "create_note",
      type: "response.function_call_arguments.done",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            [
              { item: messageItem, type: "response.output_item.done" },
              validCall,
            ]
              .map((event) => `data: ${JSON.stringify(event)}`)
              .join("\n\n"),
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
      }),
    ).rejects.toMatchObject({
      message: "L’assistant n’a pas pu répondre.",
    });
  });

  it("rejects an output_text part without text before a valid local tool call in every Responses flow", async () => {
    const providerFixture = "provider-output-text-without-text-fixture";
    const messageItem = {
      content: [{ type: "output_text" }],
      role: "assistant",
      type: "message",
    };
    const functionCall = {
      arguments: JSON.stringify({ value: providerFixture }),
      call_id: "call-after-output-text-without-text",
      name: "create_note",
      type: "function_call",
    };
    const responses = [
      new Response(JSON.stringify({ output: [messageItem, functionCall] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
      new Response(
        [
          { item: messageItem, type: "response.output_item.done" },
          { ...functionCall, type: "response.function_call_arguments.done" },
        ]
          .map((event) => `data: ${JSON.stringify(event)}`)
          .join("\n\n"),
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      ),
      new Response(
        [
          { item: messageItem, type: "response.output_item.added" },
          { ...functionCall, type: "response.function_call_arguments.done" },
        ]
          .map((event) => `data: ${JSON.stringify(event)}`)
          .join("\n\n"),
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      ),
      new Response(
        `data: ${JSON.stringify({
          response: { output: [messageItem, functionCall] },
          type: "response.completed",
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      ),
    ];

    for (const response of responses) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      let result: Awaited<ReturnType<typeof completeCodexAgent>> | undefined;
      const error = await completeCodexAgent({
        instructions: "Utilise un outil local.",
        messages: [{ content: "Crée une note.", role: "user" }],
        model: "gpt-5.6-luna",
        token,
        toolChoice: "required",
        tools: [
          {
            description: "Crée une note.",
            name: "create_note",
            parameters: { type: "object" },
          },
        ],
      })
        .then((agentResponse) => {
          result = agentResponse;
          return undefined;
        })
        .catch((reason: unknown) => reason);

      expect(result).toBeUndefined();
      expect(error).toMatchObject({
        message: "L’assistant n’a pas pu répondre.",
      });
      const serialized = JSON.stringify(
        error,
        Object.getOwnPropertyNames(error as Error),
      );
      expect(String(error)).not.toContain(providerFixture);
      expect(serialized).not.toContain(providerFixture);
    }
  });

  it("rejects a ChatGPT SSE create_note call mixed with non-blank text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            {
              arguments: '{"markdown":"# Brouillon"}',
              call_id: "call-mixed-text-and-tool",
              name: "create_note",
              type: "response.function_call_arguments.done",
            },
            {
              delta: "Une action est prête.",
              type: "response.output_text.delta",
            },
          ]
            .map((event) => `data: ${JSON.stringify(event)}`)
            .join("\n\n"),
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
            parameters: { type: "object" },
          },
        ],
        transport: "chatgpt",
      }),
    ).rejects.toThrow("L’assistant n’a pas pu répondre.");
  });

  it("rejects an unoffered streamed Responses tool before returning a later offered action without exposing its fixture", async () => {
    const providerFixture = "provider-unoffered-tool-fixture";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            {
              arguments: '{"value":"fixture"}',
              call_id: "call-unoffered",
              name: providerFixture,
              type: "response.function_call_arguments.done",
            },
            {
              arguments: '{"value":"fixture"}',
              call_id: "call-offered-after-unoffered",
              name: "create_note",
              type: "response.function_call_arguments.done",
            },
          ]
            .map((event) => `data: ${JSON.stringify(event)}`)
            .join("\n\n"),
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        ),
      ),
    );

    let result: Awaited<ReturnType<typeof completeCodexAgent>> | undefined;
    const error = await completeCodexAgent({
      instructions: "Utilise un outil local.",
      messages: [{ content: "Crée une note.", role: "user" }],
      model: "gpt-5.6-luna",
      token,
      toolChoice: "required",
      tools: [
        {
          description: "Crée une note.",
          name: "create_note",
          parameters: { type: "object" },
        },
      ],
      transport: "chatgpt",
    })
      .then((response) => {
        result = response;
        return undefined;
      })
      .catch((reason: unknown) => reason);

    expect(result).toBeUndefined();
    expect(error).toMatchObject({
      message: "L’assistant n’a pas pu répondre.",
    });
    const serialized = JSON.stringify(
      error,
      Object.getOwnPropertyNames(error as Error),
    );
    expect(String(error)).not.toContain(providerFixture);
    expect(serialized).not.toContain(providerFixture);
  });

  it("rejects an unoffered streamed added Responses tool before returning a later offered action without exposing its fixture", async () => {
    const providerFixture = "provider-added-unoffered-tool-fixture";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            {
              item: {
                arguments: '{"value":"fixture"}',
                call_id: "call-added-unoffered",
                name: providerFixture,
                type: "function_call",
              },
              type: "response.output_item.added",
            },
            {
              arguments: '{"value":"fixture"}',
              call_id: "call-offered-after-added-unoffered",
              name: "create_note",
              type: "response.function_call_arguments.done",
            },
          ]
            .map((event) => `data: ${JSON.stringify(event)}`)
            .join("\n\n"),
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        ),
      ),
    );

    let result: Awaited<ReturnType<typeof completeCodexAgent>> | undefined;
    const error = await completeCodexAgent({
      instructions: "Utilise un outil local.",
      messages: [{ content: "Crée une note.", role: "user" }],
      model: "gpt-5.6-luna",
      token,
      toolChoice: "required",
      tools: [
        {
          description: "Crée une note.",
          name: "create_note",
          parameters: { type: "object" },
        },
      ],
      transport: "chatgpt",
    })
      .then((response) => {
        result = response;
        return undefined;
      })
      .catch((reason: unknown) => reason);

    expect(result).toBeUndefined();
    expect(error).toMatchObject({
      message: "L’assistant n’a pas pu répondre.",
    });
    const serialized = JSON.stringify(
      error,
      Object.getOwnPropertyNames(error as Error),
    );
    expect(String(error)).not.toContain(providerFixture);
    expect(serialized).not.toContain(providerFixture);
  });

  it("rejects a streamed added user message before returning a later local action without exposing its fixture", async () => {
    const providerFixture = "provider-added-user-message-fixture";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            {
              item: {
                content: [{ text: providerFixture, type: "output_text" }],
                role: "user",
                type: "message",
              },
              type: "response.output_item.added",
            },
            {
              arguments: '{"value":"fixture"}',
              call_id: "call-after-added-user-message",
              name: "create_note",
              type: "response.function_call_arguments.done",
            },
          ]
            .map((event) => `data: ${JSON.stringify(event)}`)
            .join("\n\n"),
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        ),
      ),
    );

    let result: Awaited<ReturnType<typeof completeCodexAgent>> | undefined;
    const error = await completeCodexAgent({
      instructions: "Utilise un outil local.",
      messages: [{ content: "Crée une note.", role: "user" }],
      model: "gpt-5.6-luna",
      token,
      toolChoice: "required",
      tools: [
        {
          description: "Crée une note.",
          name: "create_note",
          parameters: { type: "object" },
        },
      ],
      transport: "chatgpt",
    })
      .then((response) => {
        result = response;
        return undefined;
      })
      .catch((reason: unknown) => reason);

    expect(result).toBeUndefined();
    expect(error).toMatchObject({
      message: "L’assistant n’a pas pu répondre.",
    });
    const serialized = JSON.stringify(
      error,
      Object.getOwnPropertyNames(error as Error),
    );
    expect(String(error)).not.toContain(providerFixture);
    expect(serialized).not.toContain(providerFixture);
  });

  it("rejects a malformed streamed added function call before returning a later local action without exposing its fixture", async () => {
    const providerFixture = "provider-added-malformed-call-fixture";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            {
              item: {
                call_id: providerFixture,
                name: "create_note",
                type: "function_call",
              },
              type: "response.output_item.added",
            },
            {
              arguments: '{"value":"fixture"}',
              call_id: "call-after-added-malformed-function",
              name: "create_note",
              type: "response.function_call_arguments.done",
            },
          ]
            .map((event) => `data: ${JSON.stringify(event)}`)
            .join("\n\n"),
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        ),
      ),
    );

    let result: Awaited<ReturnType<typeof completeCodexAgent>> | undefined;
    const error = await completeCodexAgent({
      instructions: "Utilise un outil local.",
      messages: [{ content: "Crée une note.", role: "user" }],
      model: "gpt-5.6-luna",
      token,
      toolChoice: "required",
      tools: [
        {
          description: "Crée une note.",
          name: "create_note",
          parameters: { type: "object" },
        },
      ],
      transport: "chatgpt",
    })
      .then((response) => {
        result = response;
        return undefined;
      })
      .catch((reason: unknown) => reason);

    expect(result).toBeUndefined();
    expect(error).toMatchObject({
      message: "L’assistant n’a pas pu répondre.",
    });
    const serialized = JSON.stringify(
      error,
      Object.getOwnPropertyNames(error as Error),
    );
    expect(String(error)).not.toContain(providerFixture);
    expect(serialized).not.toContain(providerFixture);
  });

  it.each([
    { content: {}, label: "object" },
    { content: "not-an-output-content-array", label: "string" },
    { content: null, label: "null" },
    { content: [null], label: "array containing null" },
    {
      content: ["not-an-output-content-item"],
      label: "array containing string",
    },
    { content: [[]], label: "array containing array" },
  ])(
    "rejects a streamed message output item with $label content before returning a local tool call",
    async ({ content }) => {
      const malformedEvent = {
        item: { content, type: "message" },
        type: "response.output_item.done",
      };
      const validCall = {
        arguments: '{"markdown":"# Brouillon"}',
        call_id: "call-after-malformed-streamed-message-content",
        name: "create_note",
        type: "response.function_call_arguments.done",
      };
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              [malformedEvent, validCall]
                .map((event) => `data: ${JSON.stringify(event)}`)
                .join("\n\n"),
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
        }),
      ).rejects.toMatchObject({
        message: "L’assistant n’a pas pu répondre.",
      });
    },
  );

  it.each(["", "   "])(
    "rejects blank function call arguments from every Responses API flow",
    async (argumentsValue) => {
      const functionCall = {
        arguments: argumentsValue,
        call_id: "call-blank-response",
        name: "create_note",
        type: "function_call",
      };
      const responses = [
        new Response(JSON.stringify({ output: [functionCall] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
        new Response(
          `data: ${JSON.stringify({
            ...functionCall,
            type: "response.function_call_arguments.done",
          })}\n\n`,
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        ),
        new Response(
          `data: ${JSON.stringify({
            item: functionCall,
            type: "response.output_item.done",
          })}\n\n`,
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        ),
        new Response(
          `data: ${JSON.stringify({
            response: { output: [functionCall] },
            type: "response.completed",
          })}\n\n`,
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        ),
      ];

      for (const response of responses) {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

        await expect(
          completeCodexAgent({
            instructions: "Utilise un outil local.",
            messages: [{ content: "Crée une note.", role: "user" }],
            model: "gpt-5.6-luna",
            token,
            toolChoice: "required",
          }),
        ).rejects.toThrow("L’assistant n’a pas pu répondre.");
      }
    },
  );

  it("rejects non-JSON function call arguments from every Responses flow without exposing its fixture", async () => {
    const providerFixture = "provider-non-json-arguments-fixture";
    const functionCall = {
      arguments: providerFixture,
      call_id: "call-non-json-arguments",
      name: "create_note",
      type: "function_call",
    };
    const responses = [
      new Response(JSON.stringify({ output: [functionCall] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
      new Response(
        `data: ${JSON.stringify({
          ...functionCall,
          type: "response.function_call_arguments.done",
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      ),
      new Response(
        `data: ${JSON.stringify({
          item: functionCall,
          type: "response.output_item.done",
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      ),
      new Response(
        `data: ${JSON.stringify({
          response: { output: [functionCall] },
          type: "response.completed",
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      ),
    ];

    for (const response of responses) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      let result: Awaited<ReturnType<typeof completeCodexAgent>> | undefined;
      const error = await completeCodexAgent({
        instructions: "Utilise un outil local.",
        messages: [{ content: "Crée une note.", role: "user" }],
        model: "gpt-5.6-luna",
        token,
        toolChoice: "required",
        tools: [
          {
            description: "Crée une note.",
            name: "create_note",
            parameters: { type: "object" },
          },
        ],
      })
        .then((agentResponse) => {
          result = agentResponse;
          return undefined;
        })
        .catch((reason: unknown) => reason);

      expect(result).toBeUndefined();
      expect(error).toMatchObject({
        message: "L’assistant n’a pas pu répondre.",
      });
      const serialized = JSON.stringify(
        error,
        Object.getOwnPropertyNames(error as Error),
      );
      expect(String(error)).not.toContain(providerFixture);
      expect(serialized).not.toContain(providerFixture);
    }
  });

  it.each(["", "   "])(
    "rejects blank Responses arguments even when another call is valid",
    async (argumentsValue) => {
      const blankFunctionCall = {
        arguments: argumentsValue,
        call_id: "call-blank-response",
        name: "create_note",
        type: "function_call",
      };
      const validFunctionCall = {
        arguments: '{"markdown":"# Brouillon"}',
        call_id: "call-valid-response",
        name: "create_note",
        type: "function_call",
      };
      const responses = [
        new Response(
          JSON.stringify({ output: [blankFunctionCall, validFunctionCall] }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
        new Response(
          [blankFunctionCall, validFunctionCall]
            .map(
              (call) =>
                `data: ${JSON.stringify({
                  ...call,
                  type: "response.function_call_arguments.done",
                })}`,
            )
            .join("\n\n"),
          { headers: { "content-type": "text/event-stream" }, status: 200 },
        ),
      ];

      for (const response of responses) {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

        await expect(
          completeCodexAgent({
            instructions: "Utilise un outil local.",
            messages: [{ content: "Crée une note.", role: "user" }],
            model: "gpt-5.6-luna",
            token,
            toolChoice: "required",
          }),
        ).rejects.toThrow("L’assistant n’a pas pu répondre.");
      }
    },
  );

  it.each(["call_id", "name"] as const)(
    "rejects blank Responses %s identifiers from every flow",
    async (identifier) => {
      for (const identifierValue of ["", "   "]) {
        const malformedFunctionCall = {
          arguments: '{"markdown":"# Brouillon"}',
          call_id: "call-blank-identifier",
          name: "create_note",
          type: "function_call",
          [identifier]: identifierValue,
        };
        const validFunctionCall = {
          arguments: '{"markdown":"# Brouillon"}',
          call_id: "call-valid-identifier",
          name: "create_note",
          type: "function_call",
        };
        const responses = [
          new Response(
            JSON.stringify({
              output: [malformedFunctionCall, validFunctionCall],
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          ),
          new Response(
            [malformedFunctionCall, validFunctionCall]
              .map(
                (call) =>
                  `data: ${JSON.stringify({
                    ...call,
                    type: "response.function_call_arguments.done",
                  })}`,
              )
              .join("\n\n"),
            { headers: { "content-type": "text/event-stream" }, status: 200 },
          ),
          new Response(
            [malformedFunctionCall, validFunctionCall]
              .map(
                (item) =>
                  `data: ${JSON.stringify({
                    item,
                    type: "response.output_item.done",
                  })}`,
              )
              .join("\n\n"),
            { headers: { "content-type": "text/event-stream" }, status: 200 },
          ),
          new Response(
            JSON.stringify({
              response: {
                output: [malformedFunctionCall, validFunctionCall],
              },
              type: "response.completed",
            }),
            { headers: { "content-type": "text/event-stream" }, status: 200 },
          ),
        ];

        for (const response of responses) {
          vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

          await expect(
            completeCodexAgent({
              instructions: "Utilise un outil local.",
              messages: [{ content: "Crée une note.", role: "user" }],
              model: "gpt-5.6-luna",
              token,
              toolChoice: "required",
            }),
          ).rejects.toThrow("L’assistant n’a pas pu répondre.");
        }
      }
    },
  );

  it.each(["call_id", "name", "arguments"] as const)(
    "rejects malformed Responses %s values from every flow",
    async (field) => {
      const malformedValues: Array<{ label: string; value?: unknown }> = [
        { label: "absent" },
        { label: "null", value: null },
        { label: "number", value: 42 },
        { label: "object", value: {} },
        { label: "empty", value: "" },
        { label: "blank", value: "   " },
      ];
      const validFunctionCall = {
        arguments: '{"markdown":"# Brouillon"}',
        call_id: "call-valid-response",
        name: "create_note",
        type: "function_call",
      };

      for (const { value } of malformedValues) {
        const malformedFunctionCall: Record<string, unknown> = {
          arguments: '{"markdown":"# Brouillon"}',
          call_id: "call-malformed-response",
          name: "create_note",
          type: "function_call",
        };
        if (value === undefined) {
          delete malformedFunctionCall[field];
        } else {
          malformedFunctionCall[field] = value;
        }
        const responses = [
          new Response(
            JSON.stringify({
              output: [malformedFunctionCall, validFunctionCall],
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          ),
          new Response(
            [malformedFunctionCall, validFunctionCall]
              .map(
                (call) =>
                  `data: ${JSON.stringify({
                    ...call,
                    type: "response.function_call_arguments.done",
                  })}`,
              )
              .join("\n\n"),
            { headers: { "content-type": "text/event-stream" }, status: 200 },
          ),
          new Response(
            [malformedFunctionCall, validFunctionCall]
              .map(
                (item) =>
                  `data: ${JSON.stringify({
                    item,
                    type: "response.output_item.done",
                  })}`,
              )
              .join("\n\n"),
            { headers: { "content-type": "text/event-stream" }, status: 200 },
          ),
          new Response(
            `data: ${JSON.stringify({
              response: {
                output: [malformedFunctionCall, validFunctionCall],
              },
              type: "response.completed",
            })}\n\n`,
            { headers: { "content-type": "text/event-stream" }, status: 200 },
          ),
        ];

        for (const response of responses) {
          vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

          await expect(
            completeCodexAgent({
              instructions: "Utilise un outil local.",
              messages: [{ content: "Crée une note.", role: "user" }],
              model: "gpt-5.6-luna",
              token,
              toolChoice: "required",
            }),
          ).rejects.toMatchObject({
            message: "L’assistant n’a pas pu répondre.",
          });
        }
      }
    },
  );

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

  it.each([
    { delta: null, label: "null" },
    { delta: 42, label: "number" },
    { delta: [], label: "array" },
    { delta: {}, label: "object without text" },
    { delta: { text: 42 }, label: "object with non-string text" },
  ])(
    "rejects a streamed $label text delta before returning a valid local tool call",
    async ({ delta }) => {
      const validCall = {
        arguments: '{"markdown":"# Brouillon"}',
        call_id: "call-after-malformed-text-delta",
        name: "create_note",
        type: "response.function_call_arguments.done",
      };
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              [{ delta, type: "response.output_text.delta" }, validCall]
                .map((event) => `data: ${JSON.stringify(event)}`)
                .join("\n\n"),
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
        }),
      ).rejects.toMatchObject({
        message: "L’assistant n’a pas pu répondre.",
      });
    },
  );

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

  it("rejects a refused chat completions message before returning its valid local tool call", async () => {
    const providerFixture = "provider-refusal-fixture";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "",
                  refusal: providerFixture,
                  role: "assistant",
                  tool_calls: [
                    {
                      function: { arguments: "{}", name: "create_note" },
                      id: "call-refused-message",
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

    let result: Awaited<ReturnType<typeof completeCodexAgent>> | undefined;
    const error = await completeCodexAgent({
      baseUrl,
      instructions: "Utilise un outil local.",
      messages: [{ content: "Crée une note.", role: "user" }],
      model: "glm-4.6",
      token,
      toolChoice: "required",
    })
      .then((agentResponse) => {
        result = agentResponse;
        return undefined;
      })
      .catch((reason: unknown) => reason);

    expect(result).toBeUndefined();
    expect(error).toMatchObject({
      message: "L’assistant n’a pas pu répondre.",
    });
    const serialized = JSON.stringify(
      error,
      Object.getOwnPropertyNames(error as Error),
    );
    expect(String(error)).not.toContain(providerFixture);
    expect(serialized).not.toContain(providerFixture);
  });

  it.each([
    {
      content: { providerFixture: "provider-malformed-chat-content-fixture" },
      label: "object",
    },
    {
      content: ["provider-malformed-chat-content-fixture"],
      label: "array",
    },
  ])(
    "rejects a non-null non-string $label chat completions content before returning its valid local tool call",
    async ({ content }) => {
      const providerFixture = "provider-malformed-chat-content-fixture";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content,
                    role: "assistant",
                    tool_calls: [
                      {
                        function: { arguments: "{}", name: "create_note" },
                        id: "call-malformed-content",
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

      let result: Awaited<ReturnType<typeof completeCodexAgent>> | undefined;
      const error = await completeCodexAgent({
        baseUrl,
        instructions: "Utilise un outil local.",
        messages: [{ content: "Crée une note.", role: "user" }],
        model: "glm-4.6",
        token,
        toolChoice: "required",
      })
        .then((agentResponse) => {
          result = agentResponse;
          return undefined;
        })
        .catch((reason: unknown) => reason);

      expect(result).toBeUndefined();
      expect(error).toMatchObject({
        message: "L’assistant n’a pas pu répondre.",
      });
      const serialized = JSON.stringify(
        error,
        Object.getOwnPropertyNames(error as Error),
      );
      expect(String(error)).not.toContain(providerFixture);
      expect(serialized).not.toContain(providerFixture);
    },
  );

  it.each([
    { label: "absent", message: {} },
    { label: "null", message: { refusal: null } },
  ])(
    "accepts a $label chat completions refusal with a valid local tool call",
    async ({ message }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "",
                    role: "assistant",
                    tool_calls: [
                      {
                        function: {
                          arguments: "{}",
                          name: "create_note",
                        },
                        id: "call-allowed-refusal",
                        type: "function",
                      },
                    ],
                    ...message,
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
          messages: [{ content: "Crée une note.", role: "user" }],
          model: "glm-4.6",
          token,
          toolChoice: "required",
        }),
      ).resolves.toEqual({
        functionCalls: [
          {
            arguments: "{}",
            callId: "call-allowed-refusal",
            name: "create_note",
          },
        ],
        text: "",
      });
    },
  );

  it("rejects an empty chat completions tool call array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(chatCompletionsToolCallResponse([])),
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
    { label: "absent", message: {} },
    { label: "null", message: { content: null } },
    { label: "object", message: { content: {} } },
    { label: "empty", message: { content: "" } },
  ])(
    "rejects $label chat completions text without a tool call",
    async ({ message }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [{ message: { role: "assistant", ...message } }],
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
    },
  );

  it.each(["custom", undefined])(
    "rejects a tool call whose type is not function",
    async (type) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          chatCompletionsToolCallResponse([
            {
              function: {
                arguments: '{"markdown":"# Note refusée"}',
                name: "create_note",
              },
              id: "call-non-function",
              ...(type === undefined ? {} : { type }),
            },
          ]),
        ),
      );

      await expect(
        completeCodexAgent({
          baseUrl,
          instructions: "Utilise un outil local.",
          messages: [{ content: "Crée une note.", role: "user" }],
          model: "glm-4.6",
          token,
          toolChoice: "required",
        }),
      ).rejects.toThrow("L’assistant n’a pas pu répondre.");
    },
  );

  it.each(["", "   "])(
    "rejects a function tool call with blank arguments",
    async (argumentsValue) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          chatCompletionsToolCallResponse([
            {
              function: { arguments: argumentsValue, name: "create_note" },
              id: "call-blank-arguments",
              type: "function",
            },
          ]),
        ),
      );

      await expect(
        completeCodexAgent({
          baseUrl,
          instructions: "Utilise un outil local.",
          messages: [{ content: "Crée une note.", role: "user" }],
          model: "glm-4.6",
          token,
          toolChoice: "required",
        }),
      ).rejects.toThrow("L’assistant n’a pas pu répondre.");
    },
  );

  it("rejects malformed JSON chat tool arguments without exposing the provider fixture", async () => {
    const providerFixture = "provider-malformed-chat-arguments-fixture";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        chatCompletionsToolCallResponse([
          {
            function: {
              arguments: `{\"value\":\"${providerFixture}\"`,
              name: "create_note",
            },
            id: "call-malformed-chat-arguments",
            type: "function",
          },
        ]),
      ),
    );

    let result: Awaited<ReturnType<typeof completeCodexAgent>> | undefined;
    const error = await completeCodexAgent({
      baseUrl,
      instructions: "Utilise un outil local.",
      messages: [{ content: "Crée une note.", role: "user" }],
      model: "glm-4.6",
      token,
      toolChoice: "required",
    })
      .then((agentResponse) => {
        result = agentResponse;
        return undefined;
      })
      .catch((reason: unknown) => reason);

    expect(result).toBeUndefined();
    expect(error).toMatchObject({
      message: "L’assistant n’a pas pu répondre.",
    });
    const serialized = JSON.stringify(
      error,
      Object.getOwnPropertyNames(error as Error),
    );
    expect(String(error)).not.toContain(providerFixture);
    expect(serialized).not.toContain(providerFixture);
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

  it("rejects text from a non-assistant chat completions message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "Texte de fixture non sensible.",
                  role: "user",
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
        instructions: "Réponds brièvement.",
        messages: [{ content: "Question.", role: "user" }],
        model: "glm-4.6",
        token,
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
