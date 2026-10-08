import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { describe, expect, it } from "vitest";

import {
  unwrapReplicaBaseline,
  wrapReplicaBaseline,
  type ReplicaBaseline,
} from "./replica-baseline";

const userId = "user-partition";
const vaultId = "vault-partition";
const replicaId = "replica-opaque";
const vaultKey = new Uint8Array(32).fill(6);
const baseline: ReplicaBaseline = {
  baseVariant: {
    ciphertext: [1, 2, 3, 4],
    nonce: Array.from({ length: 24 }, (_, index) => index),
  },
  bindingId: "binding-private",
  ciphertextHash: "ciphertext-identity-private",
  noteId: "note-private",
  revision: 3,
  state: "ready",
};

function baselineAad(): Uint8Array {
  return new TextEncoder().encode(
    `synapse/replica-baseline/v1/${userId}/${vaultId}/${replicaId}`,
  );
}

describe("replica baseline envelope", () => {
  it("rejects changed partitions, ciphertext, nonce, and malformed JSON with generic errors", () => {
    const envelope = wrapReplicaBaseline(
      vaultKey,
      userId,
      vaultId,
      replicaId,
      baseline,
    );
    const invalidJson = Array.from(
      xchacha20poly1305(vaultKey, new Uint8Array(24), baselineAad()).encrypt(
        new TextEncoder().encode("not-json"),
      ),
    );
    const invalidEnvelope = {
      ciphertext: invalidJson,
      nonce: new Array(24).fill(0),
    };

    const invalidReads = [
      () =>
        unwrapReplicaBaseline(
          vaultKey,
          "other-user",
          vaultId,
          replicaId,
          envelope,
        ),
      () =>
        unwrapReplicaBaseline(
          vaultKey,
          userId,
          "other-vault",
          replicaId,
          envelope,
        ),
      () =>
        unwrapReplicaBaseline(
          vaultKey,
          userId,
          vaultId,
          "other-replica",
          envelope,
        ),
      () =>
        unwrapReplicaBaseline(vaultKey, userId, vaultId, replicaId, {
          ...envelope,
          ciphertext: [...envelope.ciphertext.slice(0, -1), 0],
        }),
      () =>
        unwrapReplicaBaseline(vaultKey, userId, vaultId, replicaId, {
          ...envelope,
          nonce: envelope.nonce.slice(1),
        }),
      () =>
        unwrapReplicaBaseline(
          vaultKey,
          userId,
          vaultId,
          replicaId,
          invalidEnvelope,
        ),
    ];

    for (const read of invalidReads) {
      expect(read).toThrow("Unable to read replica baseline");
      try {
        read();
      } catch (error) {
        expect(String(error)).not.toContain(baseline.noteId);
        expect(String(error)).not.toContain(baseline.bindingId);
      }
    }
  });
});
