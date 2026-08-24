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
        parseNote(note.content).tags.some(
          (value) => value.toLowerCase() === tag,
        ),
      )
      .map((note) => ({ hint: note.path, id: note.id, label: note.label }));
  }
  const propertyMatch = /^property:([A-Za-z0-9_-]+)(?:=(.+))?$/iu.exec(trimmed);
  if (propertyMatch?.[1]) {
    const key = propertyMatch[1].toLowerCase();
    const expected = propertyMatch[2]?.trim().toLowerCase();
    return notes
      .filter((note) => {
        const value = parseNote(note.content).properties[key];
        if (value === undefined) {
          return false;
        }
        if (!expected) {
          return true;
        }
        return (Array.isArray(value) ? value : [value]).some(
          (entry) => entry.toLowerCase() === expected,
        );
      })
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

export interface OutlineEntry {
  level: number;
  text: string;
}

export function outlineFor(markdown: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  let fence: { character: string; length: number } | undefined;
  for (const line of markdown.split("\n")) {
    const trimmed = line.trimStart();
    if (fence) {
      const closing = new RegExp(
        `^${fence.character}{${fence.length},}\\s*$`,
      ).test(trimmed);
      if (closing) {
        fence = undefined;
      }
      continue;
    }
    const opening = /^(?<character>`|~){3,}/u.exec(trimmed);
    if (opening?.groups?.character) {
      fence = {
        character: opening.groups.character,
        length: opening[0].length,
      };
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(trimmed);
    if (heading?.[1] && heading[2]) {
      entries.push({ level: heading[1].length, text: heading[2].trim() });
    }
  }
  return entries;
}

export interface LocalGraph {
  edges: { source: string; target: string }[];
  nodes: { id: string; label: string }[];
}

/** Builds an in-memory graph from plaintext already held by an unlocked client. */
export function buildLocalGraph(notes: readonly QueryNote[]): LocalGraph {
  const edges: LocalGraph["edges"] = [];
  for (const note of notes) {
    for (const link of parseNote(note.content).wikilinks) {
      const target = resolveWikilink(notes, link.target);
      if (target && target.id !== note.id) {
        edges.push({ source: note.id, target: target.id });
      }
    }
  }
  return {
    edges: edges.filter(
      (edge, index) =>
        edges.findIndex(
          (candidate) =>
            candidate.source === edge.source &&
            candidate.target === edge.target,
        ) === index,
    ),
    nodes: notes.map((note) => ({ id: note.id, label: note.label })),
  };
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
