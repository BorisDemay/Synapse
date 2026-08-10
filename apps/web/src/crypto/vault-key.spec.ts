import { describe, expect, it } from "vitest";

import {
  createWrappedVaultKey,
  encodeWrappedVaultKey,
  parseWrappedVaultKey,
  unlockVaultKey,
  uuidV7,
} from "./vault-key";

const envelope = {
  ciphertext: [
    85, 120, 188, 37, 118, 13, 105, 125, 77, 169, 72, 247, 68, 166, 203, 197,
    252, 80, 81, 188, 38, 155, 235, 240, 166, 72, 223, 220, 165, 201, 147, 86,
    156, 133, 204, 235, 82, 206, 104, 242, 197, 215, 190, 165, 92, 51, 203, 45,
  ],
  nonce: [
    16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
    35, 36, 37, 38, 39,
  ],
  salt: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
};

describe("vault key unlocking", () => {
  it("unwraps the local Argon2id/XChaCha20 envelope only in memory", async () => {
    const vaultKey = await unlockVaultKey(envelope, "unlock passphrase");

    expect(vaultKey).toEqual(
      Uint8Array.from({ length: 32 }, (_, index) => index + 64),
    );
    expect(localStorage.length).toBe(0);
  });

  it("round-trips opaque envelope bytes without persisting secrets", () => {
    const bytes = encodeWrappedVaultKey(envelope);
    expect(parseWrappedVaultKey(bytes)).toEqual(envelope);
    expect(localStorage.length).toBe(0);
  });

  it("does not unlock with an incorrect passphrase", async () => {
    await expect(
      unlockVaultKey(envelope, "incorrect passphrase"),
    ).rejects.toThrow("Unable to unlock vault");
  });

  it("creates a wrap/unwrap pair that stays out of persistent storage", async () => {
    const { envelope: created, vaultKey } =
      await createWrappedVaultKey("fresh passphrase");
    const unlocked = await unlockVaultKey(created, "fresh passphrase");
    expect(unlocked).toEqual(vaultKey);
    expect(localStorage.length).toBe(0);
  });

  it("emits UUID v7 operation identifiers", () => {
    expect(uuidV7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
