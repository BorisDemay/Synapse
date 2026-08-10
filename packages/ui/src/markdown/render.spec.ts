import { describe, expect, it } from "vitest";

import { renderMarkdown } from "./render";

describe("renderMarkdown", () => {
  it("supprime les scripts du rendu", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain(
      "<script",
    );
  });

  it("convertit les retours à la ligne simples en sauts de ligne visibles", () => {
    const html = renderMarkdown("ligne un\nligne deux");
    expect(html).toContain("ligne un");
    expect(html).toContain("ligne deux");
    expect(html).toMatch(/ligne un\s*<br\s*\/?>\s*ligne deux/);
  });

  it("rend la syntaxe Markdown CommonMark courante", () => {
    const html = renderMarkdown(
      "# Titre\n\n**gras** et *italique*\n\n- item\n\n`code`",
    );
    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>gras</strong>");
    expect(html).toContain("<em>italique</em>");
    expect(html).toContain("<li>");
    expect(html).toContain("<code>code</code>");
  });
});
