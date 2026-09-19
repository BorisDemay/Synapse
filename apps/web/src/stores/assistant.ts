import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  catalogFastTier,
  clampReasoningEffort,
  completeCodexAgent,
  listCodexModels,
  type CodexFunctionCall,
  type CodexModelOption,
  type CodexReasoningLevel,
  type CodexServiceTier,
  type CodexTool,
} from "../ai/codex-client";
import {
  completeChatgptDeviceLogin,
  refreshChatgptTokens,
  startChatgptDeviceLogin,
  type ChatgptDeviceSession,
} from "../ai/codex-oauth";
import { findAssistantProvider, resolveProviderBaseUrl } from "../ai/providers";
import type {
  AssistantConversation,
  AssistantConversationMessage,
  AssistantConversationSnapshot,
} from "../crypto/ai-conversation";
import { uuidV7 } from "../crypto/vault-key";
import { useVaultStore } from "./vault";

export const ASSISTANT_INSTRUCTIONS = `Tu es l'assistant d'écriture de Synapse.
Tu pilotes le coffre local uniquement à travers les outils fournis.
Pour toute demande d'écriture, choisis exactement un outil : crée une note quand l'utilisateur demande un nouveau document, remplace une note liée pour une réécriture complète, ou ajoute du contenu pour un complément ciblé.
Ne réponds jamais avec le Markdown demandé dans le texte : transmets-le à l'outil choisi.
Si la demande ne requiert aucune écriture (question, salutation, demande d'information), réponds brièvement en texte sans appeler d'outil.
Les notes liées constituent le seul contexte de coffre disponible. Pour les modifier, utilise exclusivement leur identifiant opaque fourni dans le contexte ; n'invente jamais d'identifiant ni de fichier absent.
Ne crée pas de note pour une demande qui porte sur une note liée : choisis l'outil qui la modifie.
Ne révèle jamais de clés, jetons ou secrets.`;

const ASSISTANT_TOOLS: CodexTool[] = [
  {
    description:
      "Crée une nouvelle note locale avec le Markdown complet demandé. N'utilise cet outil que si une nouvelle note est bien l'action appropriée.",
    name: "create_note",
    parameters: {
      additionalProperties: false,
      properties: {
        markdown: {
          description: "Contenu Markdown complet de la nouvelle note.",
          type: "string",
        },
      },
      required: ["markdown"],
      type: "object",
    },
  },
  {
    description:
      "Remplace intégralement le contenu d'une note explicitement liée à cette conversation.",
    name: "replace_linked_note",
    parameters: {
      additionalProperties: false,
      properties: {
        markdown: {
          description: "Nouveau contenu Markdown complet de la note.",
          type: "string",
        },
        note_id: {
          description: "Identifiant opaque d'une note liée dans le contexte.",
          type: "string",
        },
      },
      required: ["note_id", "markdown"],
      type: "object",
    },
  },
  {
    description:
      "Ajoute du Markdown à la fin d'une note explicitement liée à cette conversation.",
    name: "append_to_linked_note",
    parameters: {
      additionalProperties: false,
      properties: {
        markdown: {
          description: "Markdown à ajouter à la fin de la note.",
          type: "string",
        },
        note_id: {
          description: "Identifiant opaque d'une note liée dans le contexte.",
          type: "string",
        },
      },
      required: ["note_id", "markdown"],
      type: "object",
    },
  },
];

export type AssistantChatMessage = AssistantConversationMessage;

export interface AssistantAttachment {
  id: string;
  label: string;
}

export interface AssistantDeviceLogin {
  userCode: string;
  verificationUrl: string;
}

export interface AssistantConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
}

function noteTitle(markdown: string, fallback: string): string {
  const heading = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));
  if (heading) {
    return heading.replace(/^#+\s+/, "").trim() || fallback;
  }
  const firstLine = markdown
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine?.slice(0, 48) || fallback;
}

function conversationTitle(prompt: string): string {
  return (
    prompt.replace(/\s+/g, " ").trim().slice(0, 48) || "Nouvelle conversation"
  );
}

function toolArguments(call: CodexFunctionCall): {
  markdown: string;
  noteId?: string;
} {
  let value: unknown;
  try {
    value = JSON.parse(call.arguments);
  } catch {
    throw new Error("L’assistant a demandé une action invalide.");
  }
  if (!value || typeof value !== "object") {
    throw new Error("L’assistant a demandé une action invalide.");
  }
  const { markdown, note_id: noteId } = value as {
    markdown?: unknown;
    note_id?: unknown;
  };
  if (typeof markdown !== "string" || !markdown.trim()) {
    throw new Error("L’assistant a demandé une action invalide.");
  }
  if (noteId !== undefined && typeof noteId !== "string") {
    throw new Error("L’assistant a demandé une action invalide.");
  }
  return { markdown, noteId };
}

export const useAssistantStore = defineStore("assistant", () => {
  const connected = ref(false);
  const busy = ref(false);
  const error = ref("");
  const model = ref("");
  const models = ref<CodexModelOption[]>([]);
  const reasoningEffort = ref("");
  const fast = ref(false);
  const messages = ref<AssistantChatMessage[]>([]);
  const attachedNoteIds = ref<string[]>([]);
  const conversations = ref<AssistantConversation[]>([]);
  const activeConversationId = ref<string | null>(null);
  const deviceLogin = ref<AssistantDeviceLogin | null>(null);
  let token: string | undefined;
  let refreshToken: string | undefined;
  let accountId: string | undefined;
  let expiresAt: number | undefined;
  let authKind: "api_key" | "chatgpt" = "api_key";
  let provider = "codex";
  let providerBaseUrl = "";
  let chatgptAbort: AbortController | undefined;
  let conversationPersistence = Promise.resolve();

  const attachments = computed<AssistantAttachment[]>(() => {
    const vault = useVaultStore();
    return attachedNoteIds.value.map((id) => ({
      id,
      label: noteTitle(vault.notes.get(id)?.content ?? "", id.slice(0, 8)),
    }));
  });

  const selectedModel = computed(() =>
    models.value.find((option) => option.id === model.value),
  );
  const reasoningLevels = computed<CodexReasoningLevel[]>(
    () => selectedModel.value?.reasoningLevels ?? [],
  );
  const fastTier = computed<CodexServiceTier | undefined>(() =>
    catalogFastTier(selectedModel.value),
  );
  const conversationSummaries = computed<AssistantConversationSummary[]>(() =>
    [...conversations.value]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
  );

  function currentConversation(): AssistantConversation | undefined {
    return conversations.value.find(
      (conversation) => conversation.id === activeConversationId.value,
    );
  }

  function activateConversation(conversation?: AssistantConversation) {
    activeConversationId.value = conversation?.id ?? null;
    messages.value = conversation ? [...conversation.messages] : [];
    attachedNoteIds.value = conversation
      ? [...conversation.attachedNoteIds]
      : [];
  }

  function createConversation(): AssistantConversation {
    const now = Date.now();
    const conversation: AssistantConversation = {
      attachedNoteIds: [],
      createdAt: now,
      id: uuidV7(),
      messages: [],
      title: "Nouvelle conversation",
      updatedAt: now,
    };
    conversations.value = [conversation, ...conversations.value];
    activateConversation(conversation);
    return conversation;
  }

  function ensureCurrentConversation(): AssistantConversation {
    return currentConversation() ?? createConversation();
  }

  function conversationSnapshot(): AssistantConversationSnapshot {
    return {
      activeConversationId: activeConversationId.value,
      conversations: conversations.value.map((conversation) => ({
        ...conversation,
        attachedNoteIds: [...conversation.attachedNoteIds],
        messages: conversation.messages.map((message) => ({ ...message })),
      })),
    };
  }

  function persistConversations(): Promise<void> {
    const snapshot = conversationSnapshot();
    const write = conversationPersistence
      .catch(() => undefined)
      .then(() => useVaultStore().persistAssistantConversations(snapshot));
    conversationPersistence = write;
    return write;
  }

  async function saveCurrentConversation(): Promise<void> {
    const current = currentConversation();
    if (!current) {
      return;
    }
    const firstUserMessage = messages.value.find(
      (message) => message.role === "user",
    );
    const updated: AssistantConversation = {
      ...current,
      attachedNoteIds: [...attachedNoteIds.value],
      messages: messages.value.map((message) => ({ ...message })),
      title:
        current.title === "Nouvelle conversation" && firstUserMessage
          ? conversationTitle(firstUserMessage.content)
          : current.title,
      updatedAt: Date.now(),
    };
    conversations.value = conversations.value.map((conversation) =>
      conversation.id === updated.id ? updated : conversation,
    );
    await persistConversations();
  }

  async function restoreConversations(): Promise<void> {
    try {
      const snapshot = await useVaultStore().loadAssistantConversations();
      conversations.value = snapshot?.conversations ?? [];
      const active = conversations.value.find(
        (conversation) => conversation.id === snapshot?.activeConversationId,
      );
      activateConversation(active ?? conversations.value[0]);
    } catch {
      conversations.value = [];
      activateConversation();
      error.value = "Historique de l’assistant illisible.";
    }
  }

  async function newConversation(): Promise<string> {
    if (busy.value) {
      throw new Error("L’assistant termine l’action en cours.");
    }
    const conversation = createConversation();
    await persistConversations();
    return conversation.id;
  }

  async function openConversation(conversationId: string): Promise<void> {
    if (busy.value) {
      throw new Error("L’assistant termine l’action en cours.");
    }
    const conversation = conversations.value.find(
      (item) => item.id === conversationId,
    );
    if (!conversation) {
      throw new Error("Conversation introuvable.");
    }
    activateConversation(conversation);
    await persistConversations();
  }

  function lockSession() {
    chatgptAbort?.abort();
    chatgptAbort = undefined;
    token = undefined;
    refreshToken = undefined;
    accountId = undefined;
    expiresAt = undefined;
    authKind = "api_key";
    provider = "codex";
    providerBaseUrl = "";
    connected.value = false;
    busy.value = false;
    error.value = "";
    messages.value = [];
    attachedNoteIds.value = [];
    conversations.value = [];
    activeConversationId.value = null;
    deviceLogin.value = null;
    models.value = [];
    model.value = "";
    reasoningEffort.value = "";
    fast.value = false;
  }

  function attachNote(noteId: string) {
    ensureCurrentConversation();
    if (attachedNoteIds.value.includes(noteId)) {
      attachedNoteIds.value = attachedNoteIds.value.filter(
        (id) => id !== noteId,
      );
      void saveCurrentConversation().catch(() => {
        error.value = "Impossible d’enregistrer la conversation.";
      });
      return;
    }
    attachedNoteIds.value = [...attachedNoteIds.value, noteId];
    void saveCurrentConversation().catch(() => {
      error.value = "Impossible d’enregistrer la conversation.";
    });
  }

  function detachNote(noteId: string) {
    attachedNoteIds.value = attachedNoteIds.value.filter((id) => id !== noteId);
    void saveCurrentConversation().catch(() => {
      error.value = "Impossible d’enregistrer la conversation.";
    });
  }

  function contextPrefix(): string {
    const vault = useVaultStore();
    const blocks = attachedNoteIds.value.flatMap((id) => {
      const note = vault.notes.get(id);
      if (!note) {
        return [];
      }
      return [
        `### Note liée (id: ${id}) — ${noteTitle(note.content, id.slice(0, 8))}\n\n${note.content}`,
      ];
    });
    if (blocks.length === 0) {
      return "";
    }
    return `Notes liées :\n\n${blocks.join("\n\n")}`;
  }

  async function persistCurrentCredential() {
    if (!token) {
      throw new Error("Clé ou jeton de l’assistant manquant.");
    }
    await useVaultStore().persistAssistantCredential({
      accountId,
      authKind,
      baseUrl: providerBaseUrl || undefined,
      expiresAt,
      fast: fast.value || undefined,
      model: model.value,
      provider,
      reasoningEffort: reasoningEffort.value || undefined,
      refreshToken,
      token,
    });
  }

  function applyCatalogConstraints() {
    reasoningEffort.value = clampReasoningEffort(
      selectedModel.value,
      reasoningEffort.value,
    );
    if (fast.value && !fastTier.value) {
      fast.value = false;
    }
  }

  async function refreshModels() {
    if (!token) {
      models.value = [];
      return;
    }
    try {
      models.value = await listCodexModels({
        accountId,
        baseUrl: providerBaseUrl || undefined,
        defaultModels: findAssistantProvider(provider)?.defaultModels,
        token,
        transport: authKind === "chatgpt" ? "chatgpt" : "platform",
      });
      if (
        models.value.length > 0 &&
        !models.value.some((option) => option.id === model.value)
      ) {
        model.value = models.value[0]?.id ?? "";
      }
      applyCatalogConstraints();
      if (token) {
        await persistCurrentCredential();
      }
    } catch (caught) {
      models.value = [];
      error.value =
        caught instanceof Error
          ? caught.message
          : "Impossible de lister les modèles.";
    }
  }

  async function setModel(nextModel: string) {
    const selected = nextModel.trim();
    if (!selected || selected === model.value) {
      return;
    }
    model.value = selected;
    applyCatalogConstraints();
    if (token) {
      await persistCurrentCredential();
    }
  }

  async function setReasoningEffort(nextEffort: string) {
    const selected = clampReasoningEffort(
      selectedModel.value,
      nextEffort.trim(),
    );
    if (selected === reasoningEffort.value) {
      return;
    }
    reasoningEffort.value = selected;
    if (token) {
      await persistCurrentCredential();
    }
  }

  async function setFast(nextFast: boolean) {
    const enabled = nextFast && Boolean(fastTier.value);
    if (enabled === fast.value) {
      return;
    }
    fast.value = enabled;
    if (token) {
      await persistCurrentCredential();
    }
  }

  async function connect(
    nextToken: string,
    options: { baseUrl?: string; provider?: string } = {},
  ) {
    error.value = "";
    const credentialToken = nextToken.trim();
    if (!credentialToken) {
      throw new Error("Clé API manquante.");
    }
    provider = options.provider?.trim() || "codex";
    // "codex" keeps the dedicated OpenAI Responses path; every other
    // provider speaks the OpenAI-compatible chat-completions API.
    providerBaseUrl =
      provider === "codex"
        ? ""
        : resolveProviderBaseUrl(provider, options.baseUrl);
    if (!providerBaseUrl && findAssistantProvider(provider)?.needsBaseUrl) {
      throw new Error("URL de l’API manquante pour ce fournisseur.");
    }
    token = credentialToken;
    refreshToken = undefined;
    accountId = undefined;
    expiresAt = undefined;
    authKind = "api_key";
    connected.value = true;
    await refreshModels();
    await persistCurrentCredential();
    await restoreConversations();
  }

  async function connectWithChatgpt() {
    error.value = "";
    chatgptAbort?.abort();
    chatgptAbort = new AbortController();
    const signal = chatgptAbort.signal;
    try {
      const session: ChatgptDeviceSession = await startChatgptDeviceLogin();
      deviceLogin.value = {
        userCode: session.userCode,
        verificationUrl: session.verificationUrl,
      };
      window.open(session.verificationUrl, "_blank", "noopener,noreferrer");
      const tokens = await completeChatgptDeviceLogin(session, { signal });
      token = tokens.accessToken;
      refreshToken = tokens.refreshToken;
      accountId = tokens.accountId;
      expiresAt = tokens.expiresAt;
      authKind = "chatgpt";
      connected.value = true;
      deviceLogin.value = null;
      await refreshModels();
      await persistCurrentCredential();
      await restoreConversations();
    } catch (caught) {
      deviceLogin.value = null;
      error.value =
        caught instanceof Error
          ? caught.message
          : "Impossible de connecter ChatGPT.";
      throw caught;
    } finally {
      chatgptAbort = undefined;
    }
  }

  function cancelChatgptLogin() {
    chatgptAbort?.abort();
    chatgptAbort = undefined;
    deviceLogin.value = null;
  }

  async function restore() {
    error.value = "";
    try {
      await restoreConversations();
      const credential = await useVaultStore().loadAssistantCredential();
      if (!credential) {
        connected.value = false;
        token = undefined;
        return;
      }
      token = credential.token;
      refreshToken = credential.refreshToken;
      accountId = credential.accountId;
      expiresAt = credential.expiresAt;
      authKind = credential.authKind;
      provider = credential.provider || "codex";
      providerBaseUrl =
        provider === "codex"
          ? ""
          : credential.baseUrl || resolveProviderBaseUrl(provider);
      model.value = credential.model;
      reasoningEffort.value = credential.reasoningEffort ?? "";
      fast.value = credential.fast === true;
      connected.value = true;
      await refreshModels();
    } catch {
      connected.value = false;
      token = undefined;
    }
  }

  async function disconnect() {
    await useVaultStore().forgetAssistantCredential();
    lockSession();
  }

  async function executeToolCall(call: CodexFunctionCall): Promise<{
    message: string;
    noteId: string;
  }> {
    const { markdown, noteId } = toolArguments(call);
    const vault = useVaultStore();
    if (call.name === "create_note" && noteId === undefined) {
      const createdNoteId = uuidV7();
      await vault.saveNote({ content: markdown, id: createdNoteId });
      return {
        message: `Note créée : ${noteTitle(markdown, "Sans titre")}`,
        noteId: createdNoteId,
      };
    }
    if (
      (call.name !== "replace_linked_note" &&
        call.name !== "append_to_linked_note") ||
      !noteId
    ) {
      throw new Error("L’assistant a demandé une action invalide.");
    }
    if (!attachedNoteIds.value.includes(noteId)) {
      throw new Error(
        "L’assistant ne peut modifier qu’une note liée explicitement.",
      );
    }
    const note = vault.notes.get(noteId);
    if (!note) {
      throw new Error("La note liée n’existe plus dans ce coffre.");
    }
    const content =
      call.name === "append_to_linked_note"
        ? `${note.content}${note.content.trim() ? "\n\n" : ""}${markdown}`
        : markdown;
    await vault.saveNote({ content, id: noteId });
    return {
      message:
        call.name === "append_to_linked_note"
          ? `Contenu ajouté : ${noteTitle(content, "Sans titre")}`
          : `Note mise à jour : ${noteTitle(content, "Sans titre")}`,
      noteId,
    };
  }

  function assistantInstructions(): string {
    const modelId = model.value.trim();
    if (!modelId) {
      return ASSISTANT_INSTRUCTIONS;
    }
    const providerLabel = findAssistantProvider(provider)?.label ?? provider;
    return `${ASSISTANT_INSTRUCTIONS}
Tu exécutes le modèle ${modelId}, fourni par ${providerLabel}. Si on te demande quel modèle tu es, réponds avec cette information.`;
  }

  async function send(prompt: string): Promise<string> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      throw new Error("Message vide.");
    }
    if (!token) {
      throw new Error("Connectez l’assistant pour écrire.");
    }
    if (
      authKind === "chatgpt" &&
      refreshToken &&
      (expiresAt === undefined || expiresAt - 5 * 60 * 1000 <= Date.now())
    ) {
      const refreshed = await refreshChatgptTokens(refreshToken);
      token = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      expiresAt = refreshed.expiresAt;
      accountId = refreshed.accountId ?? accountId;
      await persistCurrentCredential();
    }
    error.value = "";
    busy.value = true;
    ensureCurrentConversation();
    messages.value = [
      ...messages.value,
      { content: trimmed, id: uuidV7(), role: "user" },
    ];
    await saveCurrentConversation();
    const prefix = contextPrefix();
    try {
      const response = await completeCodexAgent({
        accountId,
        baseUrl: providerBaseUrl || undefined,
        instructions: assistantInstructions(),
        messages: messages.value.map((message) => ({
          content:
            message === messages.value.at(-1) &&
            message.role === "user" &&
            prefix
              ? `${prefix}\n\n---\n\nDemande :\n${message.content}`
              : message.content,
          role: message.role,
        })),
        model: model.value,
        reasoningEffort: reasoningEffort.value || undefined,
        serviceTier: fast.value ? fastTier.value?.id : undefined,
        token,
        toolChoice: "auto",
        tools: ASSISTANT_TOOLS,
        transport: authKind === "chatgpt" ? "chatgpt" : "platform",
      });
      if (response.functionCalls.length === 0) {
        const answer = response.text.trim();
        if (!answer) {
          throw new Error("L’assistant n’a pas choisi d’action.");
        }
        // Informational request: the model answered in plain text instead of
        // calling a write tool, which is valid for non-writing requests.
        messages.value = [
          ...messages.value,
          { content: answer, id: uuidV7(), role: "assistant" },
        ];
        await saveCurrentConversation();
        return "";
      }
      if (response.functionCalls.length > 1) {
        throw new Error("L’assistant a fourni plusieurs actions.");
      }
      const [call] = response.functionCalls;
      const action = await executeToolCall(call!);
      messages.value = [
        ...messages.value,
        {
          content: action.message,
          id: uuidV7(),
          role: "assistant",
        },
      ];
      await saveCurrentConversation();
      return action.noteId;
    } catch (caught) {
      error.value =
        caught instanceof Error
          ? caught.message
          : "L’assistant n’a pas pu répondre.";
      throw caught;
    } finally {
      busy.value = false;
    }
  }

  return {
    activeConversationId,
    attachNote,
    attachedNoteIds,
    attachments,
    busy,
    cancelChatgptLogin,
    connect,
    connectWithChatgpt,
    connected,
    conversations,
    conversationSummaries,
    detachNote,
    deviceLogin,
    disconnect,
    error,
    fast,
    fastTier,
    lockSession,
    messages,
    model,
    models,
    newConversation,
    openConversation,
    reasoningEffort,
    reasoningLevels,
    restore,
    send,
    setFast,
    setModel,
    setReasoningEffort,
  };
});
