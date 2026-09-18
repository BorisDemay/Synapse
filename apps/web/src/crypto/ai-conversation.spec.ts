import { describe, expect, it } from "vitest";

import {
  unwrapAssistantConversations,
  wrapAssistantConversations,
  type AssistantConversationSnapshot,
} from "./ai-conversation";

const vaultId = "0198e5de-1111-7222-8333-444455556666";
const secretMessage = "Reformule mon journal privé.";

const snapshot: AssistantConversationSnapshot = {
  activeConversationId: "conversation-1",
  conversations: [
    {
      attachedNoteIds: ["note-1"],
      createdAt: 1_700_000_000_000,
      id: "conversation-1",
      messages: [{ content: secretMessage, id: "message-1", role: "user" }],
      title: "Journal privé",
      updatedAt: 1_700_000_000_000,
    },
  ],
};

describe("assistant conversation envelope", () => {
  it("round-trips multiple conversation data only through a vault-bound ciphertext", () => {
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const envelope = wrapAssistantConversations(vaultKey, vaultId, snapshot);

    expect(JSON.stringify(envelope)).not.toContain(secretMessage);
    expect(JSON.stringify(envelope)).not.toContain("Journal privé");
    expect(envelope.nonce).toHaveLength(24);
    expect(unwrapAssistantConversations(vaultKey, vaultId, envelope)).toEqual(
      snapshot,
    );
  });

  it("rejects a conversation envelope from another vault", () => {
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const envelope = wrapAssistantConversations(vaultKey, vaultId, snapshot);

    expect(() =>
      unwrapAssistantConversations(
        vaultKey,
        "0198e5de-9999-7222-8333-444455556666",
        envelope,
      ),
    ).toThrow("Unable to read assistant conversations");
  });
});
