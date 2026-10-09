import { describe, expect, it, vi } from "vitest";

import { isLocalFolderSupported, mirrorVaultSnapshot } from "./local-folder";

describe("web local folder adapter", () => {
  it("does not claim a native folder in the browser", () => {
    expect(isLocalFolderSupported()).toBe(false);
  });

  it("is a no-op so the browser never writes a filesystem vault", async () => {
    const invoke = vi.fn();
    await mirrorVaultSnapshot("vault-id", [
      { kind: "note", markdown: "# Secret", path: "secret.md" },
    ]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
