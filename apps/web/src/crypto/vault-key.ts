import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { argon2id } from "@noble/hashes/argon2.js";

const ENVELOPE_AAD = new TextEncoder().encode("synapse/vault-key-envelope/v1");
const ARGON2_PARAMETERS = { dkLen: 32, m: 19 * 1024, p: 1, t: 2 };

export interface WrappedVaultKey {
  ciphertext: number[];
  nonce: number[];
  salt: number[];
}

export function parseWrappedVaultKey(bytes: number[]): WrappedVaultKey {
  const parsed = JSON.parse(
    new TextDecoder().decode(Uint8Array.from(bytes)),
  ) as {
    ciphertext?: unknown;
    nonce?: unknown;
    salt?: unknown;
  };
  if (
    !Array.isArray(parsed.ciphertext) ||
    !Array.isArray(parsed.nonce) ||
    !Array.isArray(parsed.salt)
  ) {
    throw new Error("Unable to unlock vault");
  }
  return {
    ciphertext: parsed.ciphertext.map(Number),
    nonce: parsed.nonce.map(Number),
    salt: parsed.salt.map(Number),
  };
}

export function encodeWrappedVaultKey(envelope: WrappedVaultKey): number[] {
  return Array.from(
    new TextEncoder().encode(
      JSON.stringify({
        salt: envelope.salt,
        nonce: envelope.nonce,
        ciphertext: envelope.ciphertext,
      }),
    ),
  );
}

export async function wrapVaultKey(
  vaultKey: Uint8Array,
  passphrase: string,
): Promise<WrappedVaultKey> {
  if (vaultKey.length !== 32) {
    throw new Error("Invalid vault key");
  }
  const salt = new Uint8Array(16);
  const nonce = new Uint8Array(24);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(nonce);

  const wrappingKey = argon2id(
    new TextEncoder().encode(passphrase),
    salt,
    ARGON2_PARAMETERS,
  );
  try {
    const ciphertext = xchacha20poly1305(
      wrappingKey,
      nonce,
      ENVELOPE_AAD,
    ).encrypt(vaultKey);
    return {
      ciphertext: Array.from(ciphertext),
      nonce: Array.from(nonce),
      salt: Array.from(salt),
    };
  } finally {
    wrappingKey.fill(0);
  }
}

export async function createWrappedVaultKey(passphrase: string): Promise<{
  envelope: WrappedVaultKey;
  vaultKey: Uint8Array;
}> {
  const vaultKey = new Uint8Array(32);
  crypto.getRandomValues(vaultKey);
  const envelope = await wrapVaultKey(vaultKey, passphrase);
  return { envelope, vaultKey };
}

export async function unlockVaultKey(
  envelope: WrappedVaultKey,
  passphrase: string,
): Promise<Uint8Array> {
  try {
    const salt = Uint8Array.from(envelope.salt);
    const nonce = Uint8Array.from(envelope.nonce);
    const ciphertext = Uint8Array.from(envelope.ciphertext);
    if (salt.length !== 16 || nonce.length !== 24) {
      throw new Error("Invalid envelope");
    }

    const wrappingKey = argon2id(
      new TextEncoder().encode(passphrase),
      salt,
      ARGON2_PARAMETERS,
    );
    try {
      const vaultKey = xchacha20poly1305(
        wrappingKey,
        nonce,
        ENVELOPE_AAD,
      ).decrypt(ciphertext);
      if (vaultKey.length !== 32) {
        throw new Error("Invalid vault key");
      }
      return vaultKey;
    } finally {
      wrappingKey.fill(0);
    }
  } catch {
    throw new Error("Unable to unlock vault");
  }
}

/** UUID v7 required by the opaque push contract. */
export function uuidV7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const timestamp = BigInt(Date.now());
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
