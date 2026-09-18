import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, channels } = vi.hoisted(() => ({
  channels: [] as Array<{ onmessage?: (message: unknown) => void }>,
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (message: unknown) => void;
    constructor() {
      channels.push(this);
    }
  },
  invoke,
}));

import { createDesktopUpdateProvider } from "./desktop-provider";

describe("desktop update provider", () => {
  beforeEach(() => {
    channels.length = 0;
    invoke.mockReset();
  });

  it("utilise uniquement les commandes updater fermees", async () => {
    invoke.mockResolvedValue({
      commitSha: "c".repeat(40),
      publishedAt: "2026-08-31T12:00:00Z",
      releaseNotes: "Release native",
      version: "0.1.42",
    });
    const provider = createDesktopUpdateProvider();

    await expect(provider.check()).resolves.toMatchObject({
      version: "0.1.42",
    });
    expect(invoke).toHaveBeenCalledWith("check_desktop_update");
  });

  it("transmet la progression du telechargement verifie", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "download_desktop_update") {
        channels[0]?.onmessage?.({ downloaded: 25, total: 100 });
        channels[0]?.onmessage?.({ downloaded: 100, total: 100 });
      }
    });
    const progress = vi.fn();

    await createDesktopUpdateProvider().prepare!(
      {
        commitSha: "c".repeat(40),
        publishedAt: "2026-08-31T12:00:00Z",
        releaseNotes: "Release native",
        version: "0.1.42",
      },
      progress,
    );

    expect(invoke).toHaveBeenCalledWith("download_desktop_update", {
      onEvent: expect.anything(),
    });
    expect(progress).toHaveBeenLastCalledWith(1);
  });

  it("installe seulement via la commande native", async () => {
    invoke.mockResolvedValue(undefined);

    await createDesktopUpdateProvider().apply({
      commitSha: "c".repeat(40),
      publishedAt: "2026-08-31T12:00:00Z",
      releaseNotes: "Release native",
      version: "0.1.42",
    });

    expect(invoke).toHaveBeenCalledWith("install_desktop_update");
  });
});
