import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { generateReleaseManifests } from "../../infra/scripts/release/generate-manifests.mjs";

const execFileAsync = promisify(execFile);

async function writeDesktopArtifacts(artifacts) {
  await mkdir(artifacts);
  for (const name of [
    "synapse-linux-x86_64.AppImage",
    "synapse-windows-x86_64.exe",
  ]) {
    await writeFile(join(artifacts, name), name);
    await writeFile(join(artifacts, `${name}.sig`), `signature-${name}`);
  }
}

test("generates immutable desktop and web manifests with one identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "synapse-release-"));
  const artifacts = join(root, "artifacts");
  await writeDesktopArtifacts(artifacts);

  await generateReleaseManifests({
    artifacts,
    baseUrl: "https://synapse.example.test",
    commitSha: "d".repeat(40),
    notes: "Release notes",
    output: join(root, "release"),
    publishedAt: "2026-08-31T12:00:00Z",
    version: "0.1.42",
  });

  const latest = JSON.parse(
    await readFile(join(root, "release/stable/latest.json"), "utf8"),
  );
  const web = JSON.parse(
    await readFile(join(root, "release/stable/web.json"), "utf8"),
  );
  assert.equal(latest.version, web.version);
  assert.equal(latest.commit_sha, web.commit_sha);
  assert.match(latest.platforms["linux-x86_64"].url, /\/0\.1\.42\//u);
  assert.match(latest.platforms["windows-x86_64"].url, /\/0\.1\.42\//u);
  assert.equal(
    latest.platforms["linux-x86_64"].signature,
    "signature-synapse-linux-x86_64.AppImage",
  );
});

test("CLI generates manifests from the release workflow environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "synapse-release-cli-"));
  const artifacts = join(root, "artifacts");
  const output = join(root, "release");
  await writeDesktopArtifacts(artifacts);

  await execFileAsync(
    process.execPath,
    ["infra/scripts/release/generate-manifests.mjs"],
    {
      env: {
        ...process.env,
        SYNAPSE_COMMIT_SHA: "e".repeat(40),
        SYNAPSE_RELEASE_ARTIFACTS: artifacts,
        SYNAPSE_RELEASE_BASE_URL: "https://synapse.example.test",
        SYNAPSE_RELEASE_NOTES: "CLI release",
        SYNAPSE_RELEASE_OUTPUT: output,
        SYNAPSE_RELEASE_PUBLISHED_AT: "2026-08-31T12:00:00Z",
        SYNAPSE_VERSION: "0.1.43",
      },
    },
  );

  const web = JSON.parse(
    await readFile(join(output, "stable/web.json"), "utf8"),
  );
  assert.equal(web.version, "0.1.43");
  assert.equal(web.commit_sha, "e".repeat(40));
});

test("refuses parity-breaking publication when one desktop platform is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "synapse-release-"));
  await writeFile(join(root, "synapse-linux-x86_64.AppImage"), "linux");
  await writeFile(join(root, "synapse-linux-x86_64.AppImage.sig"), "signature");

  await assert.rejects(
    generateReleaseManifests({
      artifacts: root,
      baseUrl: "https://synapse.example.test",
      commitSha: "d".repeat(40),
      notes: "Release notes",
      output: join(root, "release"),
      publishedAt: "2026-08-31T12:00:00Z",
      version: "0.1.42",
    }),
    /missing required release artifact/u,
  );
});
