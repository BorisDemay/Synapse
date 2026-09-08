import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  installDesktopLocalFolder,
  startDesktopFolderMirroring,
} from "./local-folder";
import {
  chooseLocalVaultFolder,
  localFolderStatus,
} from "../../../web/src/platform/local-folder";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
describe("desktop durable folder replica", () => {
  beforeEach(() => {
    invoke.mockReset();
    installDesktopLocalFolder();
  });
  it("preserves picker cancellation", async () => {
    invoke.mockResolvedValue(null);
    expect(await chooseLocalVaultFolder("")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("choose_local_vault_folder", {
      vaultId: null,
    });
  });
  it("mirrors only completed durable actions and never deletes files on lock", async () => {
    let listener: any;
    const vault: any = {
      currentVaultId: "vault",
      isUnlocked: true,
      $onAction: (callback: any) => {
        listener = callback;
        return () => {};
      },
      markdownExportNotes: () => [{ path: "note.md", content: "durable" }],
      markdownExportAttachments: () => [],
    };
    invoke.mockResolvedValue("/chosen");
    startDesktopFolderMirroring(vault);
    let completed: any;
    listener({
      name: "saveNote",
      after: (callback: any) => {
        completed = callback;
      },
    });
    expect(invoke).not.toHaveBeenCalled();
    completed();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("mirror_local_vault_folder", {
        vaultId: "vault",
        entries: [{ kind: "note", path: "note.md", markdown: "durable" }],
      }),
    );
    invoke.mockClear();
    vault.isUnlocked = false;
    completed();
    await Promise.resolve();
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("reports folder failure without rejecting the durable action", async () => {
    const { mirrorVaultSnapshot } = await import(
      "../../../web/src/platform/local-folder"
    );
    invoke.mockRejectedValue(new Error("disk failure"));
    await expect(mirrorVaultSnapshot("vault", [])).resolves.toBeNull();
    expect(localFolderStatus.error).toContain("cache chiffré");
  });
});
