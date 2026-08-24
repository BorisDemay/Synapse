import { describe, expect, it } from "vitest";

import { renderTemplate } from "./templates";

describe("vault templates", () => {
  it("renders deterministic local variables", () => {
    expect(
      renderTemplate("# {{title}}\n{{date}} {{time}}", {
        date: new Date(2026, 7, 24, 9, 5),
        title: "Journal",
      }),
    ).toBe("# Journal\n2026-08-24 09:05");
  });
});
