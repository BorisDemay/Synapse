import { describe, expect, it } from "vitest";

import { noteUpdatedAt, uuidV7Timestamp } from "./note-date";

describe("uuidV7Timestamp", () => {
  it("lit l'horodatage ms d'un UUID v7", () => {
    expect(uuidV7Timestamp("018f8e62-0000-7000-8000-000000000000")).toBe(
      1_716_080_738_304,
    );
  });
});

describe("noteUpdatedAt", () => {
  it("privilégie recordedAt de l'historique local", () => {
    expect(
      noteUpdatedAt(
        "018f8e62-0000-7000-8000-000000000000",
        "---\nupdated: 2020-01-01\n---\n",
        "2026-08-25T10:00:00.000Z",
      ),
    ).toBe(Date.parse("2026-08-25T10:00:00.000Z"));
  });

  it("retombe sur le front matter updated puis l'UUID v7", () => {
    expect(
      noteUpdatedAt("018f8e62-0000-7000-8000-000000000000", "---\nupdated: 2025-06-01\n---\n"),
    ).toBe(Date.parse("2025-06-01"));
    expect(noteUpdatedAt("note-path", "# Sans date")).toBe(0);
  });
});
