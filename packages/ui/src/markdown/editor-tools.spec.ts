import { describe, expect, it } from "vitest";

import {
  emojiForCommand,
  markdownContextMenuItems,
  type MarkdownMenuCommand,
} from "./editor-tools";

function commandItem(
  items: ReturnType<typeof markdownContextMenuItems>,
  id: string,
): MarkdownMenuCommand | undefined {
  return items.find(
    (item): item is MarkdownMenuCommand =>
      item.type === "item" && item.id === id,
  );
}

function ids(items: ReturnType<typeof markdownContextMenuItems>) {
  return items.map((item) =>
    item.type === "separator" ? "separator" : item.id,
  );
}

function submenu(
  items: ReturnType<typeof markdownContextMenuItems>,
  id: string,
) {
  const entry = items.find((item) => item.type === "submenu" && item.id === id);
  if (entry?.type !== "submenu") {
    throw new Error(`missing submenu ${id}`);
  }
  return entry;
}

describe("markdownContextMenuItems", () => {
  it("exposes every formatting action before the visible toolbar is removed", () => {
    const items = markdownContextMenuItems({ inTable: false });
    const actions = new Set(
      items.flatMap((item) => {
        if (item.type === "separator") return [];
        return item.type === "submenu"
          ? [
              item.id,
              ...item.items
                .filter((entry) => entry.type === "item")
                .map((entry) => entry.id),
            ]
          : [item.id];
      }),
    );
    const required = [
      "add-link",
      "bold",
      "italic",
      "strike",
      "list",
      "quote",
      "undo",
      "redo",
      "emoji",
      "ordered-list",
      "check",
      "outdent",
      "indent",
      "code-block",
      "inline-code",
      "line",
      "table",
      ...[1, 2, 3, 4, 5, 6].map((level) => `h${level}`),
    ];
    expect(required.filter((action) => !actions.has(action))).toEqual([]);
  });

  it("mirrors the root menu of the reference design", () => {
    const items = markdownContextMenuItems({ inTable: false });

    expect(ids(items)).toEqual([
      "undo",
      "redo",
      "separator",
      "add-link",
      "add-external-link",
      "formater",
      "paragraphe",
      "inserer",
      "emoji",
      "mode",
      "separator",
      "cut",
      "copy",
      "paste",
      "paste-plain",
      "select-all",
    ]);
  });

  it("formats inline styles, math, comments and removal", () => {
    expect(
      ids(
        submenu(markdownContextMenuItems({ inTable: false }), "formater").items,
      ),
    ).toEqual([
      "bold",
      "italic",
      "strike",
      "separator",
      "inline-code",
      "math-inline",
      "comment",
      "separator",
      "remove-format",
    ]);
  });

  it("paragraph entries cover lists, headings, body and quote", () => {
    const paragraph = submenu(
      markdownContextMenuItems({ inTable: false }),
      "paragraphe",
    );

    expect(ids(paragraph.items)).toEqual([
      "list",
      "ordered-list",
      "check",
      "outdent",
      "indent",
      "separator",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "body",
      "separator",
      "quote",
    ]);
  });

  it("marks the current heading level and body accordingly", () => {
    const { items } = submenu(
      markdownContextMenuItems({ headingLevel: 3, inTable: false }),
      "paragraphe",
    );
    const checked = items.filter(
      (item) => item.type === "item" && item.checked === true,
    );

    expect(checked.map((item) => ("id" in item ? item.id : ""))).toEqual([
      "h3",
    ]);

    const plain = submenu(
      markdownContextMenuItems({ headingLevel: 0, inTable: false }),
      "paragraphe",
    );
    const body = plain.items.find(
      (item) => item.type === "item" && item.id === "body",
    );
    expect(body?.type === "item" && body.checked).toBe(true);
  });

  it("inserts footnotes, tables, callouts and blocks", () => {
    expect(
      ids(
        submenu(markdownContextMenuItems({ inTable: false }), "inserer").items,
      ),
    ).toEqual([
      "footnote",
      "table",
      "callout",
      "line",
      "separator",
      "code-block",
      "math-block",
    ]);
  });

  it("disables clipboard cuts and copies without a selection", () => {
    const items = markdownContextMenuItems({
      inTable: false,
      selectionEmpty: true,
    });
    const cut = items.find((item) => item.type === "item" && item.id === "cut");
    const copy = items.find(
      (item) => item.type === "item" && item.id === "copy",
    );

    expect(cut?.type === "item" && cut.disabled).toBe(true);
    expect(copy?.type === "item" && copy.disabled).toBe(true);

    const withSelection = markdownContextMenuItems({
      inTable: false,
      selectionEmpty: false,
    });
    const enabledCut = withSelection.find(
      (item) => item.type === "item" && item.id === "cut",
    );
    expect(enabledCut?.type === "item" && enabledCut.disabled).toBe(false);
  });

  it("hints the insert-link shortcut without changing other commands", () => {
    const items = markdownContextMenuItems({ inTable: false });

    // jsdom reports no Mac platform, so the Windows/Linux hint is expected.
    expect(commandItem(items, "add-link")?.shortcut).toBe("Ctrl+Shift+K");
    expect(commandItem(items, "add-external-link")?.shortcut).toBeUndefined();
    expect(commandItem(items, "cut")?.shortcut).toBeUndefined();
    expect(commandItem(items, "select-all")?.shortcut).toBeUndefined();
  });

  it("uses the macOS modifier naming on Mac platforms", () => {
    Object.defineProperty(window.navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
    try {
      const items = markdownContextMenuItems({ inTable: false });

      expect(commandItem(items, "add-link")?.shortcut).toBe("Cmd+Shift+K");
    } finally {
      delete (window.navigator as { platform?: string }).platform;
    }
  });

  it("exposes local emojis and checks the current editor mode", () => {
    const items = markdownContextMenuItems({ inTable: false, viewMode: "sv" });
    expect(ids(submenu(items, "emoji").items)).toContain("emoji:smile");
    expect(emojiForCommand("emoji:smile")).toBe("😄");
    expect(emojiForCommand("emoji:malicious")).toBeUndefined();
    const mode = submenu(items, "mode").items;
    expect(
      mode.find((item) => item.type === "item" && item.id === "mode-sv"),
    ).toMatchObject({ checked: true });
    expect(
      mode.find((item) => item.type === "item" && item.id === "mode-ir"),
    ).toMatchObject({ checked: false });
  });

  it("keeps table actions in a dedicated submenu inside tables", () => {
    const withoutTable = markdownContextMenuItems({ inTable: false });
    const submenuIds = withoutTable
      .filter((item) => item.type === "submenu")
      .map((item) => item.id);
    expect(submenuIds).toEqual([
      "formater",
      "paragraphe",
      "inserer",
      "emoji",
      "mode",
    ]);

    const insideTable = markdownContextMenuItems({ inTable: true });
    const table = submenu(insideTable, "tableau");
    expect(ids(table.items)).toEqual([
      "row-add-above",
      "row-add",
      "column-add-before",
      "column-add",
      "row-delete",
      "column-delete",
    ]);
  });
});
