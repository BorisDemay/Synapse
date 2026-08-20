import { describe, expect, it } from "vitest";

import { buildVaultTree } from "./tree";

describe("buildVaultTree", () => {
  it("groupe les notes par dossiers", () => {
    const tree = buildVaultTree([
      { id: "a", label: "Inbox", path: "inbox.md" },
      { id: "b", label: "Roadmap", path: "projets/roadmap.md" },
    ]);

    expect(tree).toEqual([
      {
        children: [
          {
            id: "b",
            kind: "note",
            label: "Roadmap",
            path: "projets/roadmap.md",
            syncStatus: undefined,
            tags: undefined,
          },
        ],
        id: "folder:projets",
        kind: "folder",
        label: "projets",
        path: "projets",
      },
      {
        id: "a",
        kind: "note",
        label: "Inbox",
        path: "inbox.md",
        syncStatus: undefined,
        tags: undefined,
      },
    ]);
  });
});
