import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const AAD_PREFIX = "synapse/ai-conversation-envelope/v1";

export interface AssistantConversationMessage {
  content: string;
  id: string;
  role: "assistant" | "user";
}

export interface AssistantConversation {
  attachedNoteIds: string[];
  createdAt: number;
  id: string;
  messages: AssistantConversationMessage[];
  title: string;
  updatedAt: number;
}

export interface AssistantConversationSnapshot {
  activeConversationId: string | null;
  conversations: AssistantConversation[];
}

export interface AssistantConversationEnvelope {
  ciphertext: number[];
  nonce: number[];
}

function conversationAad(vaultId: string): Uint8Array {
  return new TextEncoder().encode(`${AAD_PREFIX}/${vaultId}`);
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(24);
  crypto.getRandomValues(nonce);
  return nonce;
}

function isMessage(value: unknown): value is AssistantConversationMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as Record<string, unknown>;
  return (
    typeof message.id === "string" &&
    typeof message.content === "string" &&
    (message.role === "assistant" || message.role === "user")
  );
}

function isConversation(value: unknown): value is AssistantConversation {
  if (!value || typeof value !== "object") {
    return false;
  }
  const conversation = value as Record<string, unknown>;
  return (
    typeof conversation.id === "string" &&
    typeof conversation.title === "string" &&
    typeof conversation.createdAt === "number" &&
    typeof conversation.updatedAt === "number" &&
    Array.isArray(conversation.attachedNoteIds) &&
    conversation.attachedNoteIds.every((id) => typeof id === "string") &&
    Array.isArray(conversation.messages) &&
    conversation.messages.every(isMessage)
  );
}

function parseSnapshot(value: unknown): AssistantConversationSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("invalid");
  }
  const snapshot = value as Record<string, unknown>;
  if (
    (snapshot.activeConversationId !== null &&
      typeof snapshot.activeConversationId !== "string") ||
    !Array.isArray(snapshot.conversations) ||
    !snapshot.conversations.every(isConversation)
  ) {
    throw new Error("invalid");
  }
  return {
    activeConversationId: snapshot.activeConversationId,
    conversations: snapshot.conversations,
  };
}

export function wrapAssistantConversations(
  vaultKey: Uint8Array,
  vaultId: string,
  snapshot: AssistantConversationSnapshot,
): AssistantConversationEnvelope {
  if (vaultKey.length !== 32) {
    throw new Error("Unable to store assistant conversations");
  }
  const nonce = randomNonce();
  const plaintext = new TextEncoder().encode(JSON.stringify(snapshot));
  const ciphertext = xchacha20poly1305(
    vaultKey,
    nonce,
    conversationAad(vaultId),
  ).encrypt(plaintext);
  return {
    ciphertext: Array.from(ciphertext),
    nonce: Array.from(nonce),
  };
}

export function unwrapAssistantConversations(
  vaultKey: Uint8Array,
  vaultId: string,
  envelope: AssistantConversationEnvelope,
): AssistantConversationSnapshot {
  try {
    const nonce = Uint8Array.from(envelope.nonce);
    if (vaultKey.length !== 32 || nonce.length !== 24) {
      throw new Error("invalid");
    }
    const plaintext = xchacha20poly1305(
      vaultKey,
      nonce,
      conversationAad(vaultId),
    ).decrypt(Uint8Array.from(envelope.ciphertext));
    return parseSnapshot(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    throw new Error("Unable to read assistant conversations");
  }
}
