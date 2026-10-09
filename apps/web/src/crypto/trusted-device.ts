import type { TrustedDeviceRecord } from "../offline/db";

const AAD_PREFIX = "synapse/trusted-device-envelope/v2";
const WRAPPING_ALGO = { length: 256, name: "AES-GCM" } as const;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function trustedDeviceAad(vaultId: string): Uint8Array {
  return new TextEncoder().encode(`${AAD_PREFIX}/${vaultId}`);
}

export function isTrustedDeviceSupported(): boolean {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle?.generateKey === "function" &&
    typeof crypto.subtle.encrypt === "function" &&
    typeof crypto.subtle.decrypt === "function"
  );
}

export async function createTrustedDevice(
  userId: string,
  vaultId: string,
  vaultKey: Uint8Array,
): Promise<TrustedDeviceRecord> {
  if (!isTrustedDeviceSupported()) {
    throw new Error("Browser wrapping unavailable");
  }
  const wrappingKey = await crypto.subtle.generateKey(WRAPPING_ALGO, false, [
    "encrypt",
    "decrypt",
  ]);
  const iv = randomBytes(12);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        additionalData: trustedDeviceAad(vaultId),
        iv,
        name: "AES-GCM",
      },
      wrappingKey,
      vaultKey,
    ),
  );
  return {
    ciphertext: Array.from(ciphertext),
    iv: Array.from(iv),
    userId,
    vaultId,
    wrappingKey,
  };
}

export async function unlockTrustedDevice(
  record: TrustedDeviceRecord,
): Promise<Uint8Array> {
  try {
    const vaultKey = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          additionalData: trustedDeviceAad(record.vaultId),
          iv: Uint8Array.from(record.iv),
          name: "AES-GCM",
        },
        record.wrappingKey,
        Uint8Array.from(record.ciphertext),
      ),
    );
    if (vaultKey.length !== 32) {
      throw new Error("Invalid trusted device envelope");
    }
    return vaultKey;
  } catch {
    throw new Error("Unable to unlock with this device");
  }
}
