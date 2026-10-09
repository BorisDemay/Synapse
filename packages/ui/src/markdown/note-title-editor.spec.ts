import { describe, expect, it } from "vitest";

import { noteBodyForEditor, restoreNoteTitle } from "./note-title-editor";

describe("note title editor projection", () => {
  it("shows the body without the canonical H1 while preserving it on save", () => {
    const markdown = "# Mon titre\n\nTexte **riche**.\n";
    expect(noteBodyForEditor(markdown)).toBe("Texte **riche**.\n");
    expect(restoreNoteTitle(markdown, "Texte modifié.\n")).toBe(
      "# Mon titre\n\nTexte modifié.\n",
    );
  });

  it("keeps front matter and later body headings editable", () => {
    const markdown = "---\nstatus: actif\n---\n# Titre\n\n## Sous-titre\n";
    const body = noteBodyForEditor(markdown);
    expect(body).toBe("---\nstatus: actif\n---\n## Sous-titre\n");
    expect(restoreNoteTitle(markdown, body)).toBe(markdown);
    expect(
      restoreNoteTitle(markdown, "---\nstatus: fini\n---\n## Suite\n"),
    ).toBe("---\nstatus: fini\n---\n# Titre\n\n## Suite\n");
  });

  it("preserves embedded image references when hiding the heading", () => {
    const markdown = "# Note\n\n![photo](attachments/photo.png)\n";
    expect(noteBodyForEditor(markdown)).toBe(
      "![photo](attachments/photo.png)\n",
    );
    expect(restoreNoteTitle(markdown, noteBodyForEditor(markdown))).toBe(
      markdown,
    );
  });

  it("keeps a blank line between front matter and a hidden title", () => {
    const markdown = "---\ntag: carnet\n---\n\n# Titre\n\nCorps";
    const body = "---\ntag: carnet\n---\n\nCorps";
    expect(noteBodyForEditor(markdown)).toBe(body);
    expect(restoreNoteTitle(markdown, body)).toBe(markdown);
  });

  it("adds a separator when editing a heading-only note", () => {
    expect(noteBodyForEditor("# Titre")).toBe("");
    expect(restoreNoteTitle("# Titre", "Corps")).toBe("# Titre\n\nCorps");
  });

  it("does not strip body text or move a heading that is not at the start", () => {
    const markdown = "Première ligne\n\n# Un titre dans le corps\n";
    expect(noteBodyForEditor(markdown)).toBe(markdown);
    expect(restoreNoteTitle(markdown, "Corps modifié")).toBe("Corps modifié");
  });
});
