import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

test("release version preserves Tauri formatting and other configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "synapse-version-test-"));
  try {
    const files = [
      "package.json",
      "apps/web/package.json",
      "apps/desktop/package.json",
      "packages/ui/package.json",
      "packages/api-client/package.json",
      "Cargo.toml",
      "apps/desktop/src-tauri/Cargo.toml",
      "apps/desktop/src-tauri/tauri.conf.json",
    ];
    for (const file of files) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), await readFile(file));
    }
    const configPath = join(root, "apps/desktop/src-tauri/tauri.conf.json");
    const original = await readFile(configPath, "utf8");
    execFileSync(
      process.execPath,
      [resolve("infra/scripts/release/set-version.mjs"), "0.1.42"],
      { cwd: root },
    );
    const updated = await readFile(configPath, "utf8");
    assert.equal(JSON.parse(updated).version, "0.1.42");
    assert.equal(
      updated,
      original.replace(/"version": "[^"]+"/u, '"version": "0.1.42"'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
