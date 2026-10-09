import { describe, expect, it } from "vitest";

import { menuIconPath } from "./editor-icons";

describe("menuIconPath", () => {
  it("dessine le wikilink avec son propre tracé, distinct du lien de l'application", () => {
    expect(menuIconPath("copy-wikilink")).not.toBe(menuIconPath("default"));
    expect(menuIconPath("copy-wikilink")).not.toBe(menuIconPath("copy-link"));
  });

  it("retombe sur le tracé par défaut quand l'identifiant est inconnu", () => {
    expect(menuIconPath("identifiant-inconnu")).toBe(menuIconPath("default"));
  });
});
