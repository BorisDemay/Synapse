import { describe, expect, it } from "vitest";

import { markdownContextMenuGroups } from "./editor-tools";

describe("markdownContextMenuGroups", () => {
  it("omits Affichage and Structure from the compact menu", () => {
    const labels = markdownContextMenuGroups({ inTable: true }).map(
      (group) => group.label,
    );

    expect(labels).toEqual(["Style", "Insérer", "Édition", "Tableau"]);
  });
});
