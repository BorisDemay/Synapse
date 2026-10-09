import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { verifyArtifactSignature } from "./prepare-updater.mjs";

// CLI wrapper used by the release workflow right after bundling. It fails the
// build when a produced artifact does not carry a valid detached updater
// signature for the configured public key.
export async function main(argv = process.argv.slice(2), env = process.env) {
  const [artifact, signatureArgument] = argv;
  if (!artifact) {
    throw new Error("usage: verify-signature.mjs <artifact> [signature]");
  }
  const publicKey = env.SYNAPSE_UPDATER_PUBLIC_KEY?.trim();
  if (!publicKey) {
    throw new Error("SYNAPSE_UPDATER_PUBLIC_KEY is missing");
  }
  const artifactPath = resolve(artifact);
  const signaturePath = resolve(signatureArgument ?? `${artifact}.sig`);
  await verifyArtifactSignature(publicKey, signaturePath, artifactPath);
  console.log(`Updater signature verified: ${artifactPath}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
