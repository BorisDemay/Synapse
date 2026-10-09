import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveDesktopBinaryPath } from "./native-webdriver-path.mjs";

const root = "/workspace/synapse";

test("resolves the Windows native desktop executable with an exe suffix", () => {
  assert.equal(
    resolveDesktopBinaryPath(root, "win32"),
    path.join(root, "apps/desktop/src-tauri/target/debug/synapse-desktop.exe"),
  );
});

test("resolves the Linux native desktop executable without an exe suffix", () => {
  assert.equal(
    resolveDesktopBinaryPath(root, "linux"),
    path.join(root, "apps/desktop/src-tauri/target/debug/synapse-desktop"),
  );
});
