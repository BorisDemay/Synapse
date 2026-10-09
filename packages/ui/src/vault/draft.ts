export const NEW_NOTE_DRAFT = "# Nouvelle note\n\n";

/** Un brouillon non persisté reste invisible tant qu'il est vide ou identique
 * au modèle d'origine : la première vraie écriture (contenu ou titre saisi
 * dans le bandeau) crée la note. */
export function isNewNoteDraft(content: string): boolean {
  return content === NEW_NOTE_DRAFT || content.trim() === "";
}
