import { describe, expect, it } from "vitest";

import { buildMarkdownZip, markdownExportFilename } from "./markdown-zip";

describe("markdown zip export", () => {
  it("packs note plaintext into a zip without sending it anywhere", () => {
    const zip = buildMarkdownZip([
      { content: "# Journal\n\nSecret line", title: "Journal" },
      { content: "Second note", title: "Ideas/draft?" },
    ]);
    const bytes = new TextDecoder("latin1").decode(zip);

    expect(bytes.slice(0, 2)).toBe("PK");
    expect(bytes).toContain("Journal.md");
    expect(bytes).toContain("Secret line");
    expect(bytes).toContain("Ideas-draft.md");
    expect(bytes).toContain("Second note");
  });

  it("keeps attachment paths inside the zip", () => {
    const zip = buildMarkdownZip(
      [{ content: "# Note", path: "notes/abc.md", title: "Note" }],
      [{ bytes: new Uint8Array([1, 2, 3]), path: "attachments/photo.png" }],
    );
    const bytes = new TextDecoder("latin1").decode(zip);
    expect(bytes).toContain("notes/abc.md");
    expect(bytes).toContain("attachments/photo.png");
  });

  it("sanitizes titles into safe markdown filenames", () => {
    expect(markdownExportFilename("../etc/passwd", [])).toBe("etc-passwd.md");
    expect(markdownExportFilename("Journal", ["Journal.md"])).toBe(
      "Journal-2.md",
    );
  });
});
