import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";

import { buildMarkdownZip } from "../export/markdown-zip";
import { planMarkdownImport, planZipImport } from "./markdown-folder";

describe("markdown folder importer", () => {
  it("previews Markdown and attachments without altering their bytes", () => {
    const image = new Uint8Array([137, 80, 78, 71]);
    const plan = planMarkdownImport([
      {
        bytes: strToU8("# Roadmap\n\n![Logo](assets/logo.png)\n"),
        path: "notes/roadmap.md",
      },
      { bytes: image, contentType: "image/png", path: "assets/logo.png" },
      { bytes: strToU8("ignored"), path: ".obsidian/workspace.json" },
      { bytes: strToU8("no"), path: "../escape.md" },
    ]);
    expect(plan.notes).toEqual([
      {
        content: "# Roadmap\n\n![Logo](attachments/assets/logo.png)\n",
        path: "notes/roadmap.md",
      },
    ]);
    expect(plan.attachments).toEqual([
      {
        bytes: image,
        contentType: "image/png",
        path: "attachments/assets/logo.png",
      },
    ]);
    expect(plan.ignored.map((item) => item.reason)).toEqual([
      "Obsidian configuration",
      "Unsafe path",
    ]);
  });

  it("reads a portable ZIP", async () => {
    const zip = buildMarkdownZip(
      [{ content: "# Inbox", path: "Inbox.md", title: "Inbox" }],
      [{ bytes: strToU8("safe"), path: "attachments/file.txt" }],
    );
    const plan = await planZipImport(zip);
    expect(plan.notes.map((note) => note.path)).toEqual(["Inbox.md"]);
    expect(plan.attachments.map((file) => file.path)).toEqual([
      "attachments/file.txt",
    ]);
    expect(plan.ignored).toEqual([]);
  });

  it("rejects an oversized entry before it is inflated into an import plan", async () => {
    const zip = buildMarkdownZip([
      {
        content: "x".repeat(10 * 1024 * 1024 + 1),
        path: "oversized.md",
        title: "Oversized",
      },
    ]);

    await expect(planZipImport(zip)).rejects.toThrow("Import is too large");
  });
});
