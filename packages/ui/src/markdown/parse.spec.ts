import { describe, expect, it } from "vitest";

import { parseNote } from "./parse";

describe("parseNote", () => {
  it("extrait titre, tags et wikilinks", () => {
    const parsed = parseNote(
      "---\ntags: [projet, mvp]\n---\n\n# Roadmap\n\nVoir [[Journal|le journal]].",
    );
    expect(parsed.title).toBe("Roadmap");
    expect(parsed.tags).toEqual(["projet", "mvp"]);
    expect(parsed.wikilinks).toEqual([
      { alias: "le journal", target: "Journal" },
    ]);
  });
});
