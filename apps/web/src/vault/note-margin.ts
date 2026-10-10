import {
  outlineFor,
  parseNote,
  resolveWikilink,
  type QueryNote,
} from "@synapse/ui";

/** Plan de la note : les titres, sans le premier niveau (affiché en tête de
 * page), avec une profondeur relative au titre le moins profond. */
export function noteOutline(markdown: string) {
  const entries = outlineFor(markdown).map((entry, index) => ({
    ...entry,
    index,
  }));
  const titleIndex = entries.findIndex((entry) => entry.level === 1);
  const rest = entries.filter((_, index) => index !== titleIndex);
  const shallowest = Math.min(...rest.map((entry) => entry.level));
  return rest.map((entry) => ({ ...entry, depth: entry.level - shallowest }));
}

/** Notes dont un wikilink se résout vers la note ouverte. Le contenu de la note
 * ouverte est pris tel qu'il est en cours d'édition. */
export function incomingLinks(
  notes: readonly QueryNote[],
  current: QueryNote,
): { id: string; label: string }[] {
  const all = notes.map((note) => (note.id === current.id ? current : note));
  return all
    .filter(
      (note) =>
        note.id !== current.id &&
        parseNote(note.content).wikilinks.some(
          (link) => resolveWikilink(all, link.target)?.id === current.id,
        ),
    )
    .map((note) => ({ id: note.id, label: note.label }));
}

/** Liens sortants uniques de la note ; un lien non résolu reste à créer. */
export function outgoingLinks(
  notes: readonly QueryNote[],
  markdown: string,
  currentId: string,
) {
  const seen = new Set<string>();
  const links: { id?: string; label: string; target: string }[] = [];
  for (const link of parseNote(markdown).wikilinks) {
    const key = link.target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const resolved = resolveWikilink(notes, link.target);
    if (resolved?.id === currentId) continue;
    links.push({
      id: resolved?.id,
      label: resolved?.label ?? link.alias ?? link.target,
      target: link.target,
    });
  }
  return links;
}

/** Propriétés du front matter, sans les tags (affichés à part). */
export function noteProperties(markdown: string) {
  return Object.entries(parseNote(markdown).properties)
    .filter(([key]) => key !== "tags")
    .map(([key, value]) => ({
      key,
      value: Array.isArray(value) ? value.join(", ") : value,
    }))
    .filter((property) => property.value);
}
