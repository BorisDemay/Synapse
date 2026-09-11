import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { verifyUpdaterSignature } from "../../infra/scripts/release/prepare-updater.mjs";

test("signing preflight rejects empty keys, mismatched keys and altered content", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = Buffer.alloc(8, 7);
  const content = Buffer.from("synthetic release");
  const key = Buffer.concat([Buffer.from("Ed"), keyId, publicKey.export({ format: "der", type: "spki" }).subarray(-32)]);
  const signature = Buffer.concat([Buffer.from("ED"), keyId, sign(null, createHash("blake2b512").update(content).digest(), privateKey)]);
  const encode = (bytes) => Buffer.from(`untrusted comment: synthetic fixture\n${bytes.toString("base64")}\n`).toString("base64");
  assert.doesNotThrow(() => verifyUpdaterSignature(encode(key), encode(signature), content));
  assert.throws(() => verifyUpdaterSignature("", encode(signature), content), /format/);
  assert.throws(() => verifyUpdaterSignature(encode(key), encode(signature), Buffer.from("tampered")), /verification failed/);
  key[2] ^= 1;
  assert.throws(() => verifyUpdaterSignature(encode(key), encode(signature), content), /do not match/);
});
