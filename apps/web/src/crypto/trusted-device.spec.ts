import { describe, expect, it } from "vitest";

import {
  createTrustedDevice,
  isTrustedDeviceSupported,
  unlockTrustedDevice,
} from "./trusted-device";

describe("trusted device encryption", () => {
  it("wraps the vault key in the browser without persisting it in the clear", async () => {
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const record = await createTrustedDevice("user-1", "vault-1", vaultKey);

    expect(isTrustedDeviceSupported()).toBe(true);
    expect(record.wrappingKey.extractable).toBe(false);
    expect(record.ciphertext).not.toEqual(Array.from(vaultKey));
    expect(
      JSON.stringify({ ciphertext: record.ciphertext, iv: record.iv }),
    ).not.toContain(Array.from(vaultKey).join(","));
    await expect(
      crypto.subtle.exportKey("raw", record.wrappingKey),
    ).rejects.toThrow();
    await expect(unlockTrustedDevice(record)).resolves.toEqual(vaultKey);
  });

  it("refuses to unwrap a tampered envelope", async () => {
    const vaultKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const record = await createTrustedDevice("user-1", "vault-1", vaultKey);
    record.ciphertext[0] = (record.ciphertext[0] ?? 0) ^ 0xff;

    await expect(unlockTrustedDevice(record)).rejects.toThrow(
      /Unable to unlock/,
    );
  });
});
