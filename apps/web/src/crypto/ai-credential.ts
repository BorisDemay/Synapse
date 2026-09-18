import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const AAD_PREFIX = "synapse/ai-credential-envelope/v1";

export type AssistantAuthKind = "api_key" | "chatgpt";

export interface AssistantCredential {
  accountId?: string;
  authKind: AssistantAuthKind;
  expiresAt?: number;
  fast?: boolean;
  model: string;
  provider: "codex";
  reasoningEffort?: string;
  refreshToken?: string;
  token: string;
}

export interface AssistantCredentialEnvelope {
  ciphertext: number[];
  nonce: number[];
}

function credentialAad(vaultId: string): Uint8Array {
  return new TextEncoder().encode(`${AAD_PREFIX}/${vaultId}`);
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(24);
  crypto.getRandomValues(nonce);
  return nonce;
}

export function wrapAssistantCredential(
  vaultKey: Uint8Array,
  vaultId: string,
  credential: AssistantCredential,
): AssistantCredentialEnvelope {
  if (vaultKey.length !== 32) {
    throw new Error("Unable to store assistant credential");
  }
  const token = credential.token.trim();
  if (!token || credential.provider !== "codex") {
    throw new Error("Unable to store assistant credential");
  }
  const nonce = randomNonce();
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      accountId: credential.accountId,
      authKind: credential.authKind,
      expiresAt: credential.expiresAt,
      ...(credential.fast ? { fast: true } : {}),
      model: credential.model.trim(),
      provider: "codex",
      ...(credential.reasoningEffort?.trim()
        ? { reasoningEffort: credential.reasoningEffort.trim() }
        : {}),
      refreshToken: credential.refreshToken,
      token,
    }),
  );
  const ciphertext = xchacha20poly1305(
    vaultKey,
    nonce,
    credentialAad(vaultId),
  ).encrypt(plaintext);
  return {
    ciphertext: Array.from(ciphertext),
    nonce: Array.from(nonce),
  };
}

export function unwrapAssistantCredential(
  vaultKey: Uint8Array,
  vaultId: string,
  envelope: AssistantCredentialEnvelope,
): AssistantCredential {
  try {
    const nonce = Uint8Array.from(envelope.nonce);
    if (vaultKey.length !== 32 || nonce.length !== 24) {
      throw new Error("invalid");
    }
    const plaintext = xchacha20poly1305(
      vaultKey,
      nonce,
      credentialAad(vaultId),
    ).decrypt(Uint8Array.from(envelope.ciphertext));
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as {
      accountId?: unknown;
      authKind?: unknown;
      expiresAt?: unknown;
      fast?: unknown;
      model?: unknown;
      provider?: unknown;
      reasoningEffort?: unknown;
      refreshToken?: unknown;
      token?: unknown;
    };
    if (
      parsed.provider !== "codex" ||
      typeof parsed.token !== "string" ||
      !parsed.token.trim() ||
      typeof parsed.model !== "string"
    ) {
      throw new Error("invalid");
    }
    const authKind: AssistantAuthKind =
      parsed.authKind === "chatgpt" ? "chatgpt" : "api_key";
    return {
      accountId:
        typeof parsed.accountId === "string" ? parsed.accountId : undefined,
      authKind,
      expiresAt:
        typeof parsed.expiresAt === "number" ? parsed.expiresAt : undefined,
      ...(parsed.fast === true ? { fast: true } : {}),
      model: parsed.model,
      provider: "codex",
      ...(typeof parsed.reasoningEffort === "string" &&
      parsed.reasoningEffort.trim()
        ? { reasoningEffort: parsed.reasoningEffort.trim() }
        : {}),
      refreshToken:
        typeof parsed.refreshToken === "string"
          ? parsed.refreshToken
          : undefined,
      token: parsed.token,
    };
  } catch {
    throw new Error("Unable to read assistant credential");
  }
}
