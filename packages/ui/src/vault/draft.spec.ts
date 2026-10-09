import { describe, expect, it } from "vitest";

import { isNewNoteDraft, NEW_NOTE_DRAFT } from "./draft";

describe("isNewNoteDraft", () => {
  it("matches the default new-note template", () => {
    expect(isNewNoteDraft(NEW_NOTE_DRAFT)).toBe(true);
  });

  it("traite un brouillon vide ou blanc comme non persisté", () => {
    expect(isNewNoteDraft("")).toBe(true);
    expect(isNewNoteDraft("   ")).toBe(true);
  });

  it("rejects edited note content", () => {
    expect(isNewNoteDraft("# Nouvelle note\n\nContenu.")).toBe(false);
    expect(isNewNoteDraft("# Titre saisi")).toBe(false);
  });
});
