import {
  CODEX_CHATGPT_RESPONSES_URL,
  CODEX_CLIENT_VERSION,
  chatgptModelsUrl,
} from "./codex-oauth";

export const CODEX_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const CODEX_PLATFORM_MODELS_URL = "https://api.openai.com/v1/models";

export interface CodexChatMessage {
  content: string;
  role: "assistant" | "user";
}

export interface CodexCompleteInput {
  accountId?: string;
  /** OpenAI-compatible base URL; enables the chat-completions path. */
  baseUrl?: string;
  /** Fallback model ids when listing is unavailable for the provider. */
  defaultModels?: string[];
  instructions: string;
  messages: CodexChatMessage[];
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string;
  token: string;
  transport?: "chatgpt" | "platform";
}

export interface CodexTool {
  description: string;
  name: string;
  parameters: Record<string, unknown>;
}

export interface CodexAgentInput extends CodexCompleteInput {
  toolChoice?: "auto" | "required";
  tools?: CodexTool[];
}

export interface CodexFunctionCall {
  arguments: string;
  callId: string;
  name: string;
}

export interface CodexAgentResponse {
  functionCalls: CodexFunctionCall[];
  text: string;
}

export interface CodexReasoningLevel {
  id: string;
  label: string;
}

export interface CodexServiceTier {
  description: string;
  id: string;
  name: string;
}

export interface CodexModelOption {
  defaultReasoningLevel?: string;
  id: string;
  label: string;
  reasoningLevels: CodexReasoningLevel[];
  serviceTiers: CodexServiceTier[];
}

interface CodexOutputText {
  text?: unknown;
  type?: unknown;
}

interface CodexOutputItem {
  arguments?: unknown;
  call_id?: unknown;
  content?: CodexOutputText[];
  name?: unknown;
  type?: unknown;
}

interface CodexResponseBody {
  output?: CodexOutputItem[];
  output_text?: unknown;
}

function assistantError(message: string): Error {
  return new Error(message);
}

function rejectMultipleFunctionCalls(
  response: CodexAgentResponse,
): CodexAgentResponse {
  if (response.functionCalls.length > 1) {
    throw assistantError("L’assistant a fourni plusieurs actions.");
  }
  return response;
}

function chatgptHeaders(
  token: string,
  accountId?: string,
  accept = "text/event-stream",
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "responses=experimental",
    originator: "codex_cli_rs",
    version: CODEX_CLIENT_VERSION,
  };
  if (accountId?.trim()) {
    headers["ChatGPT-Account-ID"] = accountId.trim();
  }
  return headers;
}

function outputText(body: CodexResponseBody): string {
  if (typeof body.output_text === "string" && body.output_text.trim()) {
    return body.output_text;
  }
  const chunks: string[] = [];
  for (const item of body.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }
  const text = chunks.join("\n").trim();
  return text;
}

function extractFunctionCalls(
  items: CodexOutputItem[] | undefined,
): CodexFunctionCall[] {
  const calls: CodexFunctionCall[] = [];
  for (const item of items ?? []) {
    if (
      item.type !== "function_call" ||
      typeof item.call_id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.arguments !== "string"
    ) {
      continue;
    }
    calls.push({
      arguments: item.arguments,
      callId: item.call_id,
      name: item.name,
    });
  }
  return calls;
}

function extractAgentResponse(body: CodexResponseBody): CodexAgentResponse {
  return {
    functionCalls: extractFunctionCalls(body.output),
    text: outputText(body),
  };
}

function extractOutputText(body: CodexResponseBody): string {
  const text = outputText(body);
  if (!text) {
    throw assistantError("L’assistant n’a pas pu répondre.");
  }
  return text;
}

function deltaText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    "text" in value &&
    typeof (value as { text: unknown }).text === "string"
  ) {
    return (value as { text: string }).text;
  }
  return "";
}

function parseResponsesSse(raw: string): CodexAgentResponse {
  let deltas = "";
  let completed = "";
  const calls: CodexFunctionCall[] = [];
  for (const block of raw.split(/\n\n+/)) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!data || data === "[DONE]") {
      continue;
    }
    let event: {
      delta?: unknown;
      arguments?: unknown;
      call_id?: unknown;
      item?: CodexOutputItem;
      name?: unknown;
      output_text?: unknown;
      response?: CodexResponseBody;
      type?: unknown;
    };
    try {
      event = JSON.parse(data) as typeof event;
    } catch {
      continue;
    }
    if (
      event.type === "response.failed" ||
      event.type === "response.incomplete"
    ) {
      throw assistantError("L’assistant n’a pas pu répondre.");
    }
    if (event.type === "response.output_text.delta") {
      deltas += deltaText(event.delta);
    }
    if (
      event.type === "response.function_call_arguments.done" &&
      typeof event.call_id === "string" &&
      typeof event.name === "string" &&
      typeof event.arguments === "string"
    ) {
      calls.push({
        arguments: event.arguments,
        callId: event.call_id,
        name: event.name,
      });
    }
    if (event.type === "response.output_item.done" && event.item) {
      calls.push(...extractFunctionCalls([event.item]));
    }
    if (event.type === "response.completed") {
      if (typeof event.output_text === "string") {
        completed = event.output_text;
      } else if (event.response) {
        const response = extractAgentResponse(event.response);
        completed = response.text;
        calls.push(...response.functionCalls);
      }
    }
  }
  const text = (completed || deltas).trim();
  const responseCalls = calls.filter((call) => {
    const first = calls.find((candidate) => candidate.callId === call.callId);
    if (!first || first === call) {
      return true;
    }
    if (first.name !== call.name || first.arguments !== call.arguments) {
      throw assistantError("L’assistant a fourni plusieurs actions.");
    }
    return false;
  });
  if (!text && responseCalls.length === 0) {
    throw assistantError("L’assistant n’a pas pu répondre.");
  }
  return { functionCalls: responseCalls, text };
}

function readAgentResponse(
  contentType: string,
  raw: string,
): CodexAgentResponse {
  const trimmed = raw.trim();
  const isSse =
    contentType.includes("event-stream") || trimmed.includes("data:");
  if (isSse) {
    return rejectMultipleFunctionCalls(parseResponsesSse(raw));
  }
  if (trimmed.startsWith("{")) {
    const response = extractAgentResponse(
      JSON.parse(trimmed) as CodexResponseBody,
    );
    if (!response.text && response.functionCalls.length === 0) {
      throw assistantError("L’assistant n’a pas pu répondre.");
    }
    return rejectMultipleFunctionCalls(response);
  }
  throw assistantError("L’assistant n’a pas pu répondre.");
}

function readAssistantText(contentType: string, raw: string): string {
  const text = readAgentResponse(contentType, raw).text;
  if (!text) {
    throw assistantError("L’assistant n’a pas pu répondre.");
  }
  return text;
}

function typedInput(messages: CodexChatMessage[]) {
  return messages.map((message) => ({
    content: [
      {
        text: message.content,
        type: message.role === "assistant" ? "output_text" : "input_text",
      },
    ],
    role: message.role,
    type: "message",
  }));
}

function parseEffortId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object" && "effort" in value) {
    return parseEffortId((value as { effort: unknown }).effort);
  }
  return "";
}

function parseReasoningLevels(value: unknown): CodexReasoningLevel[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const levels: CodexReasoningLevel[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const id = item.trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      levels.push({ id, label: id });
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as {
      description?: unknown;
      effort?: unknown;
      label?: unknown;
    };
    const id = parseEffortId(record.effort);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const label =
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : typeof record.label === "string" && record.label.trim()
          ? record.label.trim()
          : id;
    levels.push({ id, label });
  }
  return levels;
}

function parseServiceTiers(record: {
  additional_speed_tiers?: unknown;
  service_tiers?: unknown;
}): CodexServiceTier[] {
  const seen = new Set<string>();
  const tiers: CodexServiceTier[] = [];
  if (Array.isArray(record.service_tiers)) {
    for (const item of record.service_tiers) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const tier = item as {
        description?: unknown;
        id?: unknown;
        name?: unknown;
      };
      const id = typeof tier.id === "string" ? tier.id.trim() : "";
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      tiers.push({
        description:
          typeof tier.description === "string" ? tier.description : "",
        id,
        name:
          typeof tier.name === "string" && tier.name.trim() ? tier.name : id,
      });
    }
  }
  if (Array.isArray(record.additional_speed_tiers)) {
    for (const item of record.additional_speed_tiers) {
      if (typeof item !== "string") {
        continue;
      }
      const id = item.trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      tiers.push({ description: "", id, name: id });
    }
  }
  return tiers;
}

export function catalogFastTier(
  model: CodexModelOption | undefined,
): CodexServiceTier | undefined {
  return model?.serviceTiers.find((tier) => {
    const id = tier.id.trim().toLowerCase();
    const name = tier.name.trim().toLowerCase();
    return (
      id === "fast" ||
      id === "priority" ||
      name === "fast" ||
      name === "priority"
    );
  });
}

export function clampReasoningEffort(
  model: CodexModelOption | undefined,
  current: string,
): string {
  const levels = model?.reasoningLevels ?? [];
  if (levels.some((level) => level.id === current)) {
    return current;
  }
  const fallback = model?.defaultReasoningLevel?.trim() ?? "";
  if (fallback && levels.some((level) => level.id === fallback)) {
    return fallback;
  }
  return levels[0]?.id ?? "";
}

function modelLabel(id: string, displayName?: string): string {
  if (displayName?.trim()) {
    return displayName.trim();
  }
  return id
    .replace(/^gpt-/i, "GPT-")
    .replace(/-codex\b/i, " Codex")
    .replace(/-mini\b/i, " mini")
    .replace(/-sol\b/i, " Sol")
    .replace(/-terra\b/i, " Terra")
    .replace(/-luna\b/i, " Luna");
}

function collectModelRows(value: unknown, into: unknown[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectModelRows(item, into);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as {
    data?: unknown;
    display_name?: unknown;
    id?: unknown;
    models?: unknown;
    name?: unknown;
    slug?: unknown;
    title?: unknown;
  };
  if (typeof record.slug === "string" || typeof record.id === "string") {
    into.push(record);
  }
  if (record.models !== undefined) {
    collectModelRows(record.models, into);
  }
  if (record.data !== undefined) {
    collectModelRows(record.data, into);
  }
}

function parseModelList(body: unknown): CodexModelOption[] {
  const rows: unknown[] = [];
  collectModelRows(body, rows);
  const seen = new Set<string>();
  const models: Array<CodexModelOption & { priority: number }> = [];
  for (const row of rows) {
    if (typeof row === "string") {
      const trimmed = row.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      models.push({
        id: trimmed,
        label: modelLabel(trimmed),
        priority: 99,
        reasoningLevels: [],
        serviceTiers: [],
      });
      continue;
    }
    if (!row || typeof row !== "object") {
      continue;
    }
    const record = row as {
      additional_speed_tiers?: unknown;
      default_reasoning_level?: unknown;
      display_name?: unknown;
      id?: unknown;
      name?: unknown;
      priority?: unknown;
      service_tiers?: unknown;
      slug?: unknown;
      supported_reasoning_levels?: unknown;
      title?: unknown;
      visibility?: unknown;
    };
    if (record.visibility === "none") {
      continue;
    }
    const id = String(record.slug ?? record.id ?? record.name ?? "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const displayName =
      typeof record.display_name === "string"
        ? record.display_name
        : typeof record.title === "string"
          ? record.title
          : undefined;
    const defaultReasoningLevel = parseEffortId(record.default_reasoning_level);
    models.push({
      ...(defaultReasoningLevel ? { defaultReasoningLevel } : {}),
      id,
      label: modelLabel(id, displayName),
      priority: typeof record.priority === "number" ? record.priority : 99,
      reasoningLevels: parseReasoningLevels(record.supported_reasoning_levels),
      serviceTiers: parseServiceTiers(record),
    });
  }
  return models
    .sort((left, right) => {
      const delta = left.priority - right.priority;
      if (delta !== 0) {
        return delta;
      }
      return left.label.localeCompare(right.label, "fr");
    })
    .map(({ priority: _priority, ...model }) => model);
}

export async function listCodexModels(input: {
  accountId?: string;
  baseUrl?: string;
  defaultModels?: string[];
  token: string;
  transport?: "chatgpt" | "platform";
}): Promise<CodexModelOption[]> {
  const token = input.token.trim();
  if (!token) {
    throw assistantError("Clé ou jeton de l’assistant manquant.");
  }
  const chatgpt = input.transport === "chatgpt";
  const modelsUrl = input.baseUrl ? `${input.baseUrl}/models` : undefined;
  let response: Response | undefined;
  if (modelsUrl) {
    try {
      response = await fetch(modelsUrl, {
        headers: { Authorization: `Bearer ${token}` },
        method: "GET",
      });
    } catch {
      response = undefined;
    }
  } else {
    try {
      response = await fetch(
        chatgpt ? chatgptModelsUrl() : CODEX_PLATFORM_MODELS_URL,
        {
          headers: chatgpt
            ? chatgptHeaders(token, input.accountId, "application/json")
            : { Authorization: `Bearer ${token}` },
          method: "GET",
        },
      );
    } catch {
      throw assistantError("Impossible de lister les modèles.");
    }
  }
  let models: CodexModelOption[] = [];
  if (response?.ok) {
    try {
      models = parseModelList(await response.json());
    } catch {
      models = [];
    }
  }
  if (models.length === 0) {
    const fallback = (input.defaultModels ?? [])
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => ({
        id,
        label: modelLabel(id),
        priority: 99,
        reasoningLevels: [],
        serviceTiers: [],
      }));
    if (fallback.length === 0) {
      throw assistantError("Aucun modèle n’est disponible pour l’assistant.");
    }
    return fallback;
  }
  return models;
}

export async function completeCodexAgent(
  input: CodexAgentInput,
): Promise<CodexAgentResponse> {
  const token = input.token.trim();
  if (!token) {
    throw assistantError("Clé ou jeton de l’assistant manquant.");
  }
  const messages = input.messages.filter((message) => message.content.trim());
  if (messages.length === 0) {
    throw assistantError("Message vide.");
  }

  const model = input.model?.trim();
  if (!model) {
    throw assistantError("Choisissez un modèle pour l’assistant.");
  }

  const chatgpt = input.transport === "chatgpt";
  if (input.baseUrl && !chatgpt) {
    return completeChatCompletionsAgent(input);
  }
  const payload: Record<string, unknown> = {
    input: chatgpt
      ? typedInput(messages)
      : messages.map((message) => ({
          content: message.content,
          role: message.role,
        })),
    instructions: input.instructions,
    model,
    store: false,
  };
  const reasoningEffort = input.reasoningEffort?.trim();
  if (reasoningEffort) {
    payload.reasoning = { effort: reasoningEffort };
  }
  const serviceTier = input.serviceTier?.trim();
  if (serviceTier) {
    payload.service_tier = serviceTier;
  }
  if (input.tools?.length) {
    payload.tools = input.tools.map((tool) => ({
      ...tool,
      strict: true,
      type: "function",
    }));
    payload.parallel_tool_calls = false;
    payload.tool_choice = input.toolChoice ?? "auto";
  }
  if (chatgpt) {
    payload.stream = true;
  }

  const headers = chatgpt
    ? chatgptHeaders(token, input.accountId)
    : {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

  let response: Response;
  try {
    response = await fetch(
      chatgpt ? CODEX_CHATGPT_RESPONSES_URL : CODEX_RESPONSES_URL,
      {
        body: JSON.stringify(payload),
        headers,
        method: "POST",
      },
    );
  } catch {
    throw assistantError("Impossible de joindre l’assistant.");
  }

  if (response.status === 401 || response.status === 403) {
    throw assistantError("Clé ou jeton refusé par le fournisseur.");
  }
  if (response.status === 429) {
    throw assistantError("Quota du fournisseur dépassé.");
  }
  if (!response.ok) {
    throw assistantError(
      response.status === 400
        ? "Le fournisseur a refusé la requête. Vérifiez le modèle."
        : "L’assistant n’a pas pu répondre.",
    );
  }

  try {
    const raw = await response.text();
    return readAgentResponse(response.headers.get("content-type") ?? "", raw);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("L’assistant")) {
      throw error;
    }
    if (error instanceof Error && error.message.startsWith("Codex")) {
      throw error;
    }
    throw assistantError("L’assistant n’a pas pu répondre.");
  }
}

export async function completeCodexChat(
  input: CodexCompleteInput,
): Promise<string> {
  const response = await completeCodexAgent(input);
  if (response.functionCalls.length > 0 || !response.text) {
    throw assistantError("L’assistant n’a pas pu répondre.");
  }
  return response.text;
}

interface ChatCompletionsToolCall {
  function?: { arguments?: unknown; name?: unknown };
  id?: unknown;
  type?: unknown;
}

interface ChatCompletionsChoice {
  message?: {
    content?: unknown;
    role?: unknown;
    tool_calls?: unknown;
  };
}

function extractChatCompletionsFunctionCalls(
  toolCalls: unknown,
): CodexFunctionCall[] {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    throw assistantError("L’assistant n’a pas pu répondre.");
  }
  return toolCalls.map((call) => {
    if (!call || typeof call !== "object" || Array.isArray(call)) {
      throw assistantError("L’assistant n’a pas pu répondre.");
    }
    const toolCall = call as ChatCompletionsToolCall;
    const fn = toolCall.function;
    if (
      typeof toolCall.type !== "string" ||
      toolCall.type !== "function" ||
      !fn ||
      typeof fn !== "object" ||
      Array.isArray(fn) ||
      typeof toolCall.id !== "string" ||
      !toolCall.id.trim() ||
      typeof fn.name !== "string" ||
      !fn.name.trim() ||
      typeof fn.arguments !== "string"
    ) {
      throw assistantError("L’assistant n’a pas pu répondre.");
    }
    return { arguments: fn.arguments, callId: toolCall.id, name: fn.name };
  });
}

/**
 * Agent completion against any OpenAI-compatible /chat/completions endpoint
 * (GLM, DeepSeek, Mistral, OpenRouter, self-hosted gateways…).
 */
async function completeChatCompletionsAgent(
  input: CodexAgentInput,
): Promise<CodexAgentResponse> {
  const messages: Array<{ content: string; role: string }> = [
    { content: input.instructions, role: "system" },
    ...input.messages.map((message) => ({
      content: message.content,
      role: message.role,
    })),
  ];
  const payload: Record<string, unknown> = {
    messages,
    model: input.model,
  };
  if (input.tools?.length) {
    payload.tools = input.tools.map((tool) => ({
      function: {
        description: tool.description,
        name: tool.name,
        parameters: tool.parameters,
      },
      type: "function",
    }));
    payload.tool_choice = input.toolChoice ?? "auto";
    // Mirror the Responses path: one write action per turn, never a
    // parallel fan-out the agent loop cannot attribute.
    payload.parallel_tool_calls = false;
  }

  let response: Response;
  try {
    response = await fetch(`${input.baseUrl}/chat/completions`, {
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${input.token.trim()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch {
    throw assistantError("Impossible de joindre le fournisseur IA.");
  }
  if (response.status === 401 || response.status === 403) {
    throw assistantError("Clé API refusée par le fournisseur.");
  }
  if (response.status === 429) {
    throw assistantError("Quota du fournisseur dépassé.");
  }
  if (!response.ok) {
    throw assistantError(
      response.status === 400 || response.status === 404
        ? "Le fournisseur a refusé la requête. Vérifiez l’URL et le modèle."
        : "L’assistant n’a pas pu répondre.",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw assistantError("L’assistant n’a pas pu répondre.");
  }
  const choices =
    body && typeof body === "object"
      ? (body as { choices?: unknown }).choices
      : undefined;
  if (!Array.isArray(choices) || choices.length !== 1) {
    throw assistantError("L’assistant n’a pas pu répondre.");
  }
  const choice = choices[0];
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
    throw assistantError("L’assistant n’a pas pu répondre.");
  }
  const message = (choice as ChatCompletionsChoice).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw assistantError("L’assistant n’a pas pu répondre.");
  }
  if (message.role !== "assistant") {
    throw assistantError("L’assistant n’a pas pu répondre.");
  }
  const text = typeof message.content === "string" ? message.content : "";
  const toolCalls = message.tool_calls;
  const functionCalls =
    toolCalls === undefined
      ? []
      : extractChatCompletionsFunctionCalls(toolCalls);
  if (functionCalls.length === 0 && !text.trim()) {
    throw assistantError("L’assistant n’a pas pu répondre.");
  }
  if (functionCalls.length > 0 && text.trim()) {
    throw assistantError("L’assistant n’a pas pu répondre.");
  }
  return rejectMultipleFunctionCalls({ functionCalls, text });
}
