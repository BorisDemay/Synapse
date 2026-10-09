import { describe, expect, it } from "vitest";

import {
  backlinksFor,
  buildLocalGraph,
  outlineFor,
  resolveWikilink,
  sanitizeAttachmentFileName,
  searchLocalNotes,
  uniqueTags,
  wikilinkPath,
} from "./query";

const notes = [
  {
    content: "---\ntags:\n- projet\n---\n# Roadmap\n\nSee [[Inbox]].",
    id: "a",
    label: "Roadmap",
    path: "projets/roadmap.md",
  },
  {
    content: "# Inbox\n\nWelcome.",
    id: "b",
    label: "Inbox",
    path: "inbox.md",
  },
];

describe("vault query helpers", () => {
  it("filters notes by text and by tag:", () => {
    expect(searchLocalNotes(notes, "welcome").map((note) => note.id)).toEqual([
      "b",
    ]);
    expect(
      searchLocalNotes(notes, "tag:projet").map((note) => note.id),
    ).toEqual(["a"]);
  });

  it("filters front matter properties without sending them to a server", () => {
    expect(
      searchLocalNotes(notes, "property:status=active").map((note) => note.id),
    ).toEqual([]);
    const propertyNotes = [
      ...notes,
      {
        content: "---\nstatus: active\nowner: Ada\n---\n# Projet\n",
        id: "c",
        label: "Projet",
        path: "projets/projet.md",
      },
    ];
    expect(
      searchLocalNotes(propertyNotes, "property:status=active").map(
        (note) => note.id,
      ),
    ).toEqual(["c"]);
    expect(
      searchLocalNotes(propertyNotes, "property:owner").map((note) => note.id),
    ).toEqual(["c"]);
  });

  it("lists unique tags and inbound wikilinks", () => {
    expect(uniqueTags(notes)).toEqual(["projet"]);
    expect(backlinksFor(notes, notes[1]!)).toEqual([
      { id: "a", label: "Roadmap" },
    ]);
  });

  it("resolves a wikilink by title, stem or path", () => {
    expect(resolveWikilink(notes, "Roadmap")?.id).toBe("a");
    expect(resolveWikilink(notes, "inbox")?.id).toBe("b");
    expect(wikilinkPath("Cible", "projets/roadmap.md")).toBe(
      "projets/Cible.md",
    );
    expect(sanitizeAttachmentFileName("../photo.png")).toBe("photo.png");
  });

  it("derives a local outline and graph from unlocked note contents", () => {
    expect(outlineFor("# One\n## Two\n```md\n# Ignored\n```")).toEqual([
      { level: 1, text: "One" },
      { level: 2, text: "Two" },
    ]);
    expect(buildLocalGraph(notes)).toEqual({
      edges: [{ source: "a", target: "b" }],
      nodes: [
        { id: "a", label: "Roadmap" },
        { id: "b", label: "Inbox" },
      ],
    });
  });
});
