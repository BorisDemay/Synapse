import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const benchmarkPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "client-benchmark.mjs",
);

test("client benchmark rejects a virtualized tree DOM regression", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "synapse-benchmark-"));
  const temporaryBenchmarkPath = join(
    dirname(benchmarkPath),
    `${basename(temporaryDirectory)}.mjs`,
  );

  try {
    const source = readFileSync(benchmarkPath, "utf8")
      .replace(
        "treeitems: document.querySelectorAll('[role=\"treeitem\"]').length,",
        "treeitems: 81,",
      )
      .replace(
        'dom_elements: document.querySelectorAll("*").length,',
        "dom_elements: 585,",
      );
    writeFileSync(temporaryBenchmarkPath, source);

    let status = 0;
    try {
      execFileSync(process.execPath, [temporaryBenchmarkPath], {
        cwd: join(dirname(benchmarkPath), "../.."),
        env: {
          ...process.env,
          SYNAPSE_BENCH_NOTES: "10000",
          SYNAPSE_BENCH_TIMEOUT_MS: "30000",
        },
        stdio: "ignore",
      });
    } catch (error) {
      status = error.status ?? 1;
    }

    assert.notEqual(status, 0);
  } finally {
    rmSync(temporaryBenchmarkPath, { force: true });
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});
