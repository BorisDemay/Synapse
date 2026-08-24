import { describe, expect, it } from "vitest";

import {
  unwrapVaultPreferences,
  wrapVaultPreferences,
} from "./vault-preferences";

describe("vault preferences envelope", () => {
  it("encrypts paths and saved searches with the vault key", () => {
    const key = new Uint8Array(32).fill(9);
    const preferences = {
      dailyNotePattern: "Daily/YYYY-MM-DD.md",
      pinnedNoteIds: ["note-1"],
      recentNoteIds: ["note-1"],
      savedSearches: [
        { id: "search-1", label: "Active", query: "property:status=active" },
      ],
      templatesPath: "Templates",
    };
    const envelope = wrapVaultPreferences(key, "vault-1", preferences);
    expect(JSON.stringify(envelope)).not.toContain("Daily/");
    expect(unwrapVaultPreferences(key, "vault-1", envelope)).toEqual(
      preferences,
    );
    expect(() => unwrapVaultPreferences(key, "vault-2", envelope)).toThrow(
      "Unable to read vault preferences",
    );
  });

  it("reads a preferences envelope created before recent notes existed", () => {
    const key = new Uint8Array(32).fill(4);
    const legacy = {
      dailyNotePattern: "Daily/YYYY-MM-DD.md",
      pinnedNoteIds: [],
      savedSearches: [],
      templatesPath: "Templates",
    };
    const envelope = wrapVaultPreferences(key, "vault-1", legacy as never);
    expect(unwrapVaultPreferences(key, "vault-1", envelope)).toEqual({
      ...legacy,
      recentNoteIds: [],
    });
  });
});
