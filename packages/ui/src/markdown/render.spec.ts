import { describe, expect, it } from "vitest";

import { renderMarkdown } from "./render";

describe("renderMarkdown", () => {
  it("supprime les scripts du rendu", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain(
      "<script",
    );
  });
});
