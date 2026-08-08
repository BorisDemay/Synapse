import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false });

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(markdown.render(source));
}
