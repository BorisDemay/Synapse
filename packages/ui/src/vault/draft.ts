export const NEW_NOTE_DRAFT = "# Nouvelle note\n\n";

export function isNewNoteDraft(content: string): boolean {
  return content === NEW_NOTE_DRAFT;
}
