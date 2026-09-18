import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

import {
  verifyArtifactSignature,
  verifyUpdaterSignature,
} from "../../infra/scripts/release/prepare-updater.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const signatureVerifier = join(
  repositoryRoot,
  "infra/scripts/release/verify-signature.mjs",
);

function encode(bytes) {
  return Buffer.from(
    `untrusted comment: synthetic fixture\n${bytes.toString("base64")}\n`,
  ).toString("base64");
}

function syntheticKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = Buffer.alloc(8, 7);
  const key = Buffer.concat([
    Buffer.from("Ed"),
    keyId,
    publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  ]);
  return {
    publicKey: encode(key),
    sign(content) {
      const signature = Buffer.concat([
        Buffer.from("ED"),
        keyId,
        sign(
          null,
          createHash("blake2b512").update(content).digest(),
          privateKey,
        ),
      ]);
      return encode(signature);
    },
  };
}

test("signing preflight rejects empty keys, mismatched keys and altered content", () => {
  const keys = syntheticKeys();
  const other = syntheticKeys();
  const content = Buffer.from("synthetic release");
  const key = Buffer.from(keys.publicKey, "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/u)[1];
  assert.doesNotThrow(() =>
    verifyUpdaterSignature(keys.publicKey, keys.sign(content), content),
  );
  assert.throws(
    () => verifyUpdaterSignature("", keys.sign(content), content),
    /format/,
  );
  assert.throws(
    () =>
      verifyUpdaterSignature(
        keys.publicKey,
        keys.sign(content),
        Buffer.from("tampered"),
      ),
    /verification failed/,
  );
  const mismatched = { ...keys, publicKey: other.publicKey };
  assert.throws(
    () =>
      verifyUpdaterSignature(mismatched.publicKey, keys.sign(content), content),
    /do not match|verification failed/,
  );
  assert.equal(Buffer.from(key, "base64").length, 42);
});

test("artifact verification accepts a matching signature and rejects tampering", async () => {
  const keys = syntheticKeys();
  const root = await mkdtemp(join(tmpdir(), "synapse-signature-"));
  try {
    const content = Buffer.from("synthetic updater artifact");
    const artifact = join(root, "synapse-linux-x86_64.AppImage");
    const signaturePath = `${artifact}.sig`;
    await writeFile(artifact, content);
    await writeFile(signaturePath, keys.sign(content));

    await assert.doesNotReject(() =>
      verifyArtifactSignature(keys.publicKey, signaturePath, artifact),
    );

    await writeFile(artifact, Buffer.from("tampered artifact"));
    await assert.rejects(
      () => verifyArtifactSignature(keys.publicKey, signaturePath, artifact),
      /verification failed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("signature verifier CLI validates a built artifact against the public key", async () => {
  const keys = syntheticKeys();
  const root = await mkdtemp(join(tmpdir(), "synapse-signature-cli-"));
  try {
    const content = Buffer.from("built updater artifact");
    const artifact = join(root, "synapse-windows-x86_64.exe");
    await writeFile(artifact, content);
    await writeFile(`${artifact}.sig`, keys.sign(content));

    const success = await execFileAsync(
      process.execPath,
      [signatureVerifier, artifact],
      { env: { ...process.env, SYNAPSE_UPDATER_PUBLIC_KEY: keys.publicKey } },
    );
    assert.match(success.stdout, /signature verified/u);

    await writeFile(artifact, Buffer.from("swapped artifact"));
    await assert.rejects(
      execFileAsync(process.execPath, [signatureVerifier, artifact], {
        env: { ...process.env, SYNAPSE_UPDATER_PUBLIC_KEY: keys.publicKey },
      }),
      /verification failed/u,
    );

    await assert.rejects(
      execFileAsync(process.execPath, [signatureVerifier, artifact], {
        env: { ...process.env, SYNAPSE_UPDATER_PUBLIC_KEY: "" },
      }),
      /SYNAPSE_UPDATER_PUBLIC_KEY/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
