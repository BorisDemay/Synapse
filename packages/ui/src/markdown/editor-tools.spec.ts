import { describe, expect, it } from "vitest";

import { markdownContextMenuItems } from "./editor-tools";

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
  it("mirrors the root menu of the reference design", () => {
    const items = markdownContextMenuItems({ inTable: false });

    expect(ids(items)).toEqual([
      "add-link",
      "add-external-link",
      "formater",
      "paragraphe",
      "inserer",
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

  it("keeps table actions in a dedicated submenu inside tables", () => {
    const withoutTable = markdownContextMenuItems({ inTable: false });
    const submenuIds = withoutTable
      .filter((item) => item.type === "submenu")
      .map((item) => item.id);
    expect(submenuIds).toEqual(["formater", "paragraphe", "inserer"]);

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
