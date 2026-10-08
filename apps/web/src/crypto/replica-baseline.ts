import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const AAD_PREFIX = "synapse/replica-baseline/v1";
const MAX_CIPHERTEXT_BYTES = 1024 * 1024;
const MAX_IDENTIFIER_LENGTH = 512;

export interface ReplicaBaseline {
  baseVariant: {
    ciphertext: number[];
    nonce: number[];
  };
  bindingId: string;
  ciphertextHash: string;
  noteId: string;
  revision: number;
  state: "installing" | "ready";
}

export interface ReplicaBaselineEnvelope {
  ciphertext: number[];
  nonce: number[];
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH
  );
}

function isByteArray(
  value: unknown,
  maxLength = MAX_CIPHERTEXT_BYTES,
): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= maxLength &&
    value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  );
}

function aad(userId: string, vaultId: string, replicaId: string): Uint8Array {
  return new TextEncoder().encode(
    `${AAD_PREFIX}/${userId}/${vaultId}/${replicaId}`,
  );
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(24);
  crypto.getRandomValues(nonce);
  return nonce;
}

function parseBaseline(value: unknown): ReplicaBaseline {
  if (!value || typeof value !== "object") {
    throw new Error("invalid");
  }
  const baseline = value as Record<string, unknown>;
  const baseVariant = baseline.baseVariant;
  if (
    !baseVariant ||
    typeof baseVariant !== "object" ||
    !isIdentifier(baseline.bindingId) ||
    !isIdentifier(baseline.ciphertextHash) ||
    !isIdentifier(baseline.noteId) ||
    !Number.isSafeInteger(baseline.revision) ||
    (baseline.state !== "installing" && baseline.state !== "ready") ||
    !isByteArray((baseVariant as Record<string, unknown>).ciphertext) ||
    !isByteArray((baseVariant as Record<string, unknown>).nonce, 24) ||
    ((baseVariant as Record<string, unknown>).nonce as unknown[]).length !== 24
  ) {
    throw new Error("invalid");
  }
  return {
    baseVariant: {
      ciphertext: [...(baseVariant as { ciphertext: number[] }).ciphertext],
      nonce: [...(baseVariant as { nonce: number[] }).nonce],
    },
    bindingId: baseline.bindingId,
    ciphertextHash: baseline.ciphertextHash,
    noteId: baseline.noteId,
    revision: baseline.revision as number,
    state: baseline.state,
  };
}

function validateContext(
  vaultKey: Uint8Array,
  userId: string,
  vaultId: string,
  replicaId: string,
): void {
  if (
    vaultKey.length !== 32 ||
    !isIdentifier(userId) ||
    !isIdentifier(vaultId) ||
    !isIdentifier(replicaId)
  ) {
    throw new Error("invalid");
  }
}

export function wrapReplicaBaseline(
  vaultKey: Uint8Array,
  userId: string,
  vaultId: string,
  replicaId: string,
  baseline: ReplicaBaseline,
): ReplicaBaselineEnvelope {
  try {
    validateContext(vaultKey, userId, vaultId, replicaId);
    const plaintext = new TextEncoder().encode(
      JSON.stringify(parseBaseline(baseline)),
    );
    if (plaintext.length > MAX_CIPHERTEXT_BYTES) {
      throw new Error("invalid");
    }
    const nonce = randomNonce();
    return {
      ciphertext: Array.from(
        xchacha20poly1305(
          vaultKey,
          nonce,
          aad(userId, vaultId, replicaId),
        ).encrypt(plaintext),
      ),
      nonce: Array.from(nonce),
    };
  } catch {
    throw new Error("Unable to store replica baseline");
  }
}

export function unwrapReplicaBaseline(
  vaultKey: Uint8Array,
  userId: string,
  vaultId: string,
  replicaId: string,
  envelope: ReplicaBaselineEnvelope,
): ReplicaBaseline {
  try {
    validateContext(vaultKey, userId, vaultId, replicaId);
    if (
      !isByteArray(envelope.ciphertext) ||
      !isByteArray(envelope.nonce, 24) ||
      envelope.nonce.length !== 24
    ) {
      throw new Error("invalid");
    }
    const plaintext = xchacha20poly1305(
      vaultKey,
      Uint8Array.from(envelope.nonce),
      aad(userId, vaultId, replicaId),
    ).decrypt(Uint8Array.from(envelope.ciphertext));
    if (plaintext.length > MAX_CIPHERTEXT_BYTES) {
      throw new Error("invalid");
    }
    return parseBaseline(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    throw new Error("Unable to read replica baseline");
  }
}
