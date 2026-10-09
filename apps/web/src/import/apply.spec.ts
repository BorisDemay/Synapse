import { describe, expect, it } from "vitest";

import { applyMarkdownImport } from "./apply";

describe("confirmed Markdown import", () => {
  it("stops safely after the current encrypted item when cancelled", async () => {
    let cancelled = false;
    const progress: string[] = [];
    const saved: string[] = [];

    const result = await applyMarkdownImport(
      {
        attachments: [
          {
            bytes: new Uint8Array([1]),
            contentType: "image/png",
            path: "attachments/a.png",
          },
        ],
        ignored: [],
        notes: [
          { content: "# One", path: "one.md" },
          { content: "# Two", path: "two.md" },
        ],
      },
      {
        findNoteId: () => undefined,
        saveAttachment: async (attachment) => {
          saved.push(attachment.path);
        },
        saveNote: async (note) => {
          saved.push(note.path);
          cancelled = true;
        },
      },
      {
        isCancelled: () => cancelled,
        onProgress: ({ completed, total }) =>
          progress.push(`${completed}/${total}`),
      },
    );

    expect(saved).toEqual(["one.md"]);
    expect(progress).toEqual(["1/3"]);
    expect(result).toEqual({ cancelled: true, completed: 1, total: 3 });
  });
});
