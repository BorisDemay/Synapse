import { describe, expect, it } from "vitest";

import {
  unwrapAssistantCredential,
  wrapAssistantCredential,
  type AssistantCredential,
} from "./ai-credential";

const vaultId = "0198e5de-1111-7222-8333-444455556666";
const token = "sk-live-super-secret";

const credential: AssistantCredential = {
  authKind: "api_key",
  model: "gpt-5.4",
  provider: "codex",
  token,
};

describe("assistant credential envelope", () => {
  it("round-trips a Codex token without persisting it in the envelope fields", async () => {
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const envelope = wrapAssistantCredential(vaultKey, vaultId, credential);

    expect(envelope.ciphertext).not.toEqual(
      Array.from(new TextEncoder().encode(token)),
    );
    expect(JSON.stringify(envelope)).not.toContain(token);
    expect(envelope.nonce).toHaveLength(24);

    await expect(
      Promise.resolve(unwrapAssistantCredential(vaultKey, vaultId, envelope)),
    ).resolves.toEqual(credential);
  });

  it("rejects an envelope bound to another vault", () => {
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const envelope = wrapAssistantCredential(vaultKey, vaultId, credential);

    expect(() =>
      unwrapAssistantCredential(
        vaultKey,
        "0198e5de-9999-7222-8333-444455556666",
        envelope,
      ),
    ).toThrow("Unable to read assistant credential");
  });

  it("round-trips a ChatGPT refresh token inside the envelope only", () => {
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const chatgpt: AssistantCredential = {
      accountId: "acct-42",
      authKind: "chatgpt",
      expiresAt: 1_700_000_000_000,
      model: "gpt-5.4",
      provider: "codex",
      refreshToken: "chatgpt-refresh-secret",
      token: "chatgpt-access-secret",
    };
    const envelope = wrapAssistantCredential(vaultKey, vaultId, chatgpt);
    expect(JSON.stringify(envelope)).not.toContain("chatgpt-refresh-secret");
    expect(JSON.stringify(envelope)).not.toContain("chatgpt-access-secret");
    expect(unwrapAssistantCredential(vaultKey, vaultId, envelope)).toEqual(
      chatgpt,
    );
  });

  it("round-trips reasoning effort and fast without leaking them on the envelope", () => {
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const tuned: AssistantCredential = {
      ...credential,
      fast: true,
      reasoningEffort: "xhigh",
    };
    const envelope = wrapAssistantCredential(vaultKey, vaultId, tuned);
    expect(JSON.stringify(envelope)).not.toContain("xhigh");
    expect(unwrapAssistantCredential(vaultKey, vaultId, envelope)).toEqual(
      tuned,
    );
  });
});
