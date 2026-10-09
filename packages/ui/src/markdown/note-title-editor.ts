// The first H1 (after optional front matter) is edited in the workspace
// header. Keep it in canonical Markdown for export/sync, but not in either
// editor mode. Later headings are part of the editable body.
function frontMatterPrefix(markdown: string): string {
  return /^---\r?\n[\s\S]*?\r?\n---\r?\n(?:\r?\n)?/u.exec(markdown)?.[0] ?? "";
}

function splitHeaderTitle(markdown: string): {
  body: string;
  heading: string;
  hasFrontMatter: boolean;
} {
  const prefix = frontMatterPrefix(markdown);
  const rest = markdown.slice(prefix.length);
  const match = /^# [^\r\n]+(?:\r?\n)?/u.exec(rest);
  if (!match) return { body: markdown, heading: "", hasFrontMatter: false };

  let heading = match[0];
  if (rest.slice(heading.length).startsWith("\r\n")) heading += "\r\n";
  else if (rest.slice(heading.length).startsWith("\n")) heading += "\n";
  return {
    body: prefix + rest.slice(heading.length),
    heading,
    hasFrontMatter: Boolean(prefix),
  };
}

export function noteBodyForEditor(markdown: string): string {
  return splitHeaderTitle(markdown).body;
}

export function restoreNoteTitle(markdown: string, editedBody: string): string {
  const { heading, hasFrontMatter } = splitHeaderTitle(markdown);
  if (!heading) return editedBody;
  const prefix = hasFrontMatter ? frontMatterPrefix(editedBody) : "";
  const body = editedBody.slice(prefix.length);
  const separator = body && !heading.endsWith("\n") ? "\n\n" : "";
  return prefix + heading + separator + body;
}
