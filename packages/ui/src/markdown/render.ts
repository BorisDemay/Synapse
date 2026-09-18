import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

/** CommonMark + soft breaks (newline → <br>), like GitHub comments. */
const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
});

markdown.core.ruler.after("inline", "synapse-wikilinks", (state) => {
  for (const token of state.tokens) {
    if (token.type !== "inline" || !token.children) {
      continue;
    }
    const next = [];
    for (const child of token.children) {
      if (child.type !== "text" || !child.content.includes("[[")) {
        next.push(child);
        continue;
      }
      const parts = child.content.split(/(\[\[[^[\]]+\]\])/u);
      for (const part of parts) {
        const match = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/u.exec(part);
        if (!match) {
          const text = new state.Token("text", "", 0);
          text.content = part;
          next.push(text);
          continue;
        }
        const target = sanitizeWikilink(match[1] ?? "");
        const alias = sanitizeWikilink(match[2] || match[1] || "");
        const link = new state.Token("link_open", "a", 1);
        link.attrSet("href", `#${encodeURIComponent(target)}`);
        link.attrSet("data-wikilink", target);
        const text = new state.Token("text", "", 0);
        text.content = alias;
        const close = new state.Token("link_close", "a", -1);
        next.push(link, text, close);
      }
    }
    token.children = next;
  }
});

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(markdown.render(source), {
    ADD_ATTR: ["data-wikilink"],
  });
}

function sanitizeWikilink(value: string): string {
  return value.replace(/[^a-zA-Z0-9 ._/-]/g, "").trim();
}
