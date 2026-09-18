import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

// Any server test binary that takes the shared session advisory lock resets the
// same PostgreSQL database, so it must run in the serialized server-db group.
// Missing an entry lets two binaries race on the lock and flake the suite.
test("every shared PostgreSQL test binary is serialized in nextest", async () => {
  const testsDirectory = join(repositoryRoot, "apps/server/tests");
  const entries = await readdir(testsDirectory);
  const shared = [];
  for (const entry of entries.filter((name) => name.endsWith(".rs"))) {
    const contents = await readFile(join(testsDirectory, entry), "utf8");
    if (contents.includes("test_database_lock")) {
      shared.push(entry.replace(/\.rs$/u, ""));
    }
  }
  assert.ok(shared.length > 0, "shared-lock test binaries were discovered");

  const nextest = await readFile(
    join(repositoryRoot, ".config/nextest.toml"),
    "utf8",
  );
  const overrides = [
    ...nextest.matchAll(
      /\[\[profile\.default\.overrides\]\]([\s\S]*?)(?=\n\[\[|\s*$)/gu,
    ),
  ].map((match) => match[1]);
  const serverDb = overrides.find((block) =>
    block.includes("test-group = 'server-db'"),
  );
  assert.ok(serverDb, "the server-db nextest override exists");
  const filter = serverDb.match(/filter = '([^']+)'/u)?.[1];
  assert.ok(filter, "the server-db override declares a filter");
  const serialized = new Set(
    [...filter.matchAll(/binary\(([^)]+)\)/gu)].map((match) => match[1]),
  );

  for (const binary of shared) {
    assert.ok(
      serialized.has(binary),
      `${binary} takes the shared test database lock and must join the server-db test group`,
    );
  }
});
