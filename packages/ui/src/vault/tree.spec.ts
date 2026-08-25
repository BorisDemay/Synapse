import { describe, expect, it } from "vitest";

import { buildVaultTree } from "./tree";

describe("buildVaultTree", () => {
  it("tri les notes par date décroissante par défaut", () => {
    const tree = buildVaultTree([
      { id: "old", label: "Ancienne", path: "ancienne.md", updatedAt: 100 },
      { id: "new", label: "Récente", path: "recente.md", updatedAt: 200 },
    ]);

    expect(tree.map((node) => node.id)).toEqual(["new", "old"]);
  });

  it("trie les notes d'un dossier du plus récent au plus ancien", () => {
    const tree = buildVaultTree([
      {
        id: "b",
        label: "Beta",
        path: "projets/beta.md",
        updatedAt: 50,
      },
      {
        id: "a",
        label: "Alpha",
        path: "projets/alpha.md",
        updatedAt: 150,
      },
    ]);

    expect(tree[0]?.children?.map((node) => node.id)).toEqual(["a", "b"]);
  });

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
