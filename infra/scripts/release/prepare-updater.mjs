import { createHash, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function verifyUpdaterSignature(publicKey, signature, content) {
  const keyLines = Buffer.from(publicKey, "base64").toString("utf8").trim().split(/\r?\n/u);
  const sigLines = Buffer.from(signature, "base64").toString("utf8").trim().split(/\r?\n/u);
  if (!keyLines[0]?.startsWith("untrusted comment:") || !sigLines[0]?.startsWith("untrusted comment:"))
    throw new Error("invalid updater key or signature format");
  const key = Buffer.from(keyLines[1], "base64");
  const sig = Buffer.from(sigLines[1], "base64");
  if (key.length !== 42 || sig.length !== 74 || !key.subarray(2, 10).equals(sig.subarray(2, 10)))
    throw new Error("updater public and private keys do not match");
  const algorithm = sig.subarray(0, 2).toString();
  if (!["Ed", "ED"].includes(algorithm)) throw new Error("unsupported updater signature");
  const message = algorithm === "ED" ? createHash("blake2b512").update(content).digest() : content;
  const spki = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]), format: "der", type: "spki" });
  if (!verify(null, message, spki, sig.subarray(10))) throw new Error("updater signature verification failed");
}

// Verify the detached updater signature produced by the bundler against the
// configured public key. Used by the release workflow after signing so a
// tampered or mismatched artifact fails before publication.
export async function verifyArtifactSignature(publicKey, signaturePath, artifactPath) {
  const signature = await readFile(signaturePath, "utf8");
  const content = await readFile(artifactPath);
  verifyUpdaterSignature(publicKey, signature, content);
}

export async function prepareUpdater() {
  const publicKey = process.env.SYNAPSE_UPDATER_PUBLIC_KEY?.trim();
  if (!publicKey || !process.env.TAURI_SIGNING_PRIVATE_KEY || !process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD)
    throw new Error("updater signing secrets or public key missing");
  const temporary = await mkdtemp(join(tmpdir(), "synapse-signing-preflight-"));
  try {
    const file = join(temporary, "probe.txt");
    const content = Buffer.from("Synapse release signing preflight\n");
    await writeFile(file, content);
    const requireDesktop = createRequire(resolve("apps/desktop/package.json"));
    try {
      execFileSync(process.execPath, [requireDesktop.resolve("@tauri-apps/cli/tauri.js"), "signer", "sign", file], { stdio: "pipe" });
    } catch {
      throw new Error("updater signing preflight failed: check private key and password");
    }
    verifyUpdaterSignature(publicKey, await readFile(`${file}.sig`, "utf8"), content);
    const configPath = "apps/desktop/src-tauri/tauri.conf.json";
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.plugins ??= {};
    config.plugins.updater = { ...config.plugins.updater, pubkey: publicKey };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log("Updater signing verified; bundler public key configured.");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await prepareUpdater();
