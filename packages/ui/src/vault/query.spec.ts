import { describe, expect, it } from "vitest";

import {
  backlinksFor,
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
    expect(searchLocalNotes(notes, "tag:projet").map((note) => note.id)).toEqual(
      ["a"],
    );
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
    expect(wikilinkPath("Cible", "projets/roadmap.md")).toBe("projets/Cible.md");
    expect(sanitizeAttachmentFileName("../photo.png")).toBe("photo.png");
  });
});
