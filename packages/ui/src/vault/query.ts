import { parseNote } from "../markdown/parse";

export interface QueryNote {
  content: string;
  id: string;
  label: string;
  path: string;
}

export function noteStem(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/iu, "");
}

export function searchLocalNotes(
  notes: readonly QueryNote[],
  query: string,
): { hint?: string; id: string; label: string }[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const tagMatch = /^tag:(\S+)/iu.exec(trimmed);
  if (tagMatch?.[1]) {
    const tag = tagMatch[1].toLowerCase();
    return notes
      .filter((note) =>
        parseNote(note.content).tags.some((value) => value.toLowerCase() === tag),
      )
      .map((note) => ({ hint: note.path, id: note.id, label: note.label }));
  }
  const needle = trimmed.toLowerCase();
  return notes
    .filter(
      (note) =>
        note.label.toLowerCase().includes(needle) ||
        note.path.toLowerCase().includes(needle) ||
        note.content.toLowerCase().includes(needle),
    )
    .map((note) => ({ hint: note.path, id: note.id, label: note.label }));
}

export function uniqueTags(notes: readonly QueryNote[]): string[] {
  const tags = new Set<string>();
  for (const note of notes) {
    for (const tag of parseNote(note.content).tags) {
      tags.add(tag);
    }
  }
  return [...tags].sort((left, right) => left.localeCompare(right, "fr"));
}

export function backlinksFor(
  notes: readonly QueryNote[],
  current: QueryNote,
): { id: string; label: string }[] {
  const parsed = parseNote(current.content);
  const targets = new Set(
    [current.path, noteStem(current.path), parsed.title, current.label]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase()),
  );
  return notes
    .filter((note) => {
      if (note.id === current.id) {
        return false;
      }
      return parseNote(note.content).wikilinks.some((link) =>
        targets.has(link.target.toLowerCase()),
      );
    })
    .map((note) => ({ id: note.id, label: note.label }));
}

export function resolveWikilink(
  notes: readonly QueryNote[],
  target: string,
): QueryNote | undefined {
  const needle = target.trim().toLowerCase();
  return notes.find((note) => {
    const title = parseNote(note.content).title?.toLowerCase() ?? "";
    return (
      note.path.toLowerCase() === needle ||
      note.path.toLowerCase() === `${needle}.md` ||
      noteStem(note.path).toLowerCase() === needle ||
      note.label.toLowerCase() === needle ||
      title === needle
    );
  });
}

export function wikilinkPath(target: string, currentPath: string): string {
  const cleaned = target
    .replaceAll("\\", "/")
    .replaceAll("..", "")
    .replace(/^\/+/u, "");
  const file = cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`;
  if (file.includes("/")) {
    return file;
  }
  const slash = currentPath.lastIndexOf("/");
  const folder = slash >= 0 ? currentPath.slice(0, slash + 1) : "";
  return `${folder}${file}`;
}

export function sanitizeAttachmentFileName(name: string): string {
  const base = name.replaceAll("\\", "/").split("/").pop() ?? "file";
  return base.replace(/[<>:"|?*\u0000-\u001f]/gu, "-") || "file";
}
