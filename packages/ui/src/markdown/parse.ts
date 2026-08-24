export interface ParsedNote {
  properties: Record<string, string | string[]>;
  tags: string[];
  title: string | null;
  wikilinks: { alias: string | null; target: string }[];
}

export function parseNote(source: string): ParsedNote {
  const { body, frontMatter } = splitFrontMatter(source);
  const wikilinks: ParsedNote["wikilinks"] = [];
  let fence: { character: string; length: number } | undefined;
  let title: string | null = null;

  for (const line of body.split("\n")) {
    if (fence) {
      if (isClosingFence(line, fence.character, fence.length)) {
        fence = undefined;
      }
      continue;
    }
    const opening = openingFence(line);
    if (opening) {
      fence = opening;
      continue;
    }
    if (!title && line.startsWith("# ")) {
      title = line.slice(2);
    }
    extractWikilinks(line, wikilinks);
  }

  return {
    properties: extractProperties(frontMatter),
    tags: extractTags(frontMatter),
    title,
    wikilinks,
  };
}

function extractProperties(
  frontMatter: string,
): Record<string, string | string[]> {
  const properties: Record<string, string | string[]> = {};
  let listKey: string | undefined;
  for (const line of frontMatter.split("\n")) {
    const listItem = /^\s+-\s+(.+)$/u.exec(line);
    if (listKey && listItem?.[1]) {
      const existing = properties[listKey];
      properties[listKey] = Array.isArray(existing)
        ? [...existing, listItem[1].trim()]
        : [listItem[1].trim()];
      continue;
    }
    listKey = undefined;
    const pair = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/u.exec(line);
    if (!pair?.[1]) {
      continue;
    }
    const key = pair[1].toLowerCase();
    const value = pair[2]?.trim() ?? "";
    if (!value) {
      properties[key] = [];
      listKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      properties[key] = value
        .slice(1, -1)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    } else {
      properties[key] = value.replace(/^['"]|['"]$/gu, "");
    }
  }
  return properties;
}

function splitFrontMatter(source: string): {
  body: string;
  frontMatter: string;
} {
  if (!source.startsWith("---\n")) {
    return { body: source, frontMatter: "" };
  }
  const after = source.slice(4);
  const end = after.indexOf("\n---\n");
  if (end < 0) {
    return { body: source, frontMatter: "" };
  }
  return {
    body: after.slice(end + 5),
    frontMatter: after.slice(0, end),
  };
}

function extractTags(frontMatter: string): string[] {
  const tags: string[] = [];
  let reading = false;
  for (const line of frontMatter.split("\n")) {
    const inline =
      line.startsWith("tags: [") && line.endsWith("]")
        ? line.slice(7, -1)
        : null;
    if (inline !== null) {
      for (const tag of inline.split(",").map((value) => value.trim())) {
        if (tag) {
          tags.push(tag);
        }
      }
      return tags;
    }
    if (line === "tags:") {
      reading = true;
      continue;
    }
    if (reading) {
      const item = line.trim().startsWith("- ") ? line.trim().slice(2) : null;
      if (item) {
        tags.push(item);
      } else if (!line.startsWith(" ") && !line.startsWith("\t")) {
        break;
      }
    }
  }
  return tags;
}

function extractWikilinks(source: string, wikilinks: ParsedNote["wikilinks"]) {
  let remainder = source;
  while (remainder.includes("[[")) {
    const start = remainder.indexOf("[[");
    const escaped =
      remainder.slice(0, start).split("").reverse().join("").match(/^\\+/)?.[0]
        .length ?? 0;
    const after = remainder.slice(start + 2);
    const end = after.indexOf("]]");
    if (end < 0) {
      break;
    }
    const raw = after.slice(0, end);
    const [target, alias] = raw.split("|", 2);
    if (escaped % 2 === 0 && target) {
      wikilinks.push({ alias: alias ?? null, target });
    }
    remainder = after.slice(end + 2);
  }
}

function openingFence(line: string) {
  const trimmed = line.trimStart();
  const character = trimmed[0];
  if (character !== "`" && character !== "~") {
    return undefined;
  }
  let length = 0;
  while (trimmed[length] === character) {
    length += 1;
  }
  return length >= 3 ? { character, length } : undefined;
}

function isClosingFence(
  line: string,
  character: string,
  openingLength: number,
) {
  const trimmed = line.trimStart();
  let length = 0;
  while (trimmed[length] === character) {
    length += 1;
  }
  return length >= openingLength && trimmed.slice(length).trim() === "";
}
