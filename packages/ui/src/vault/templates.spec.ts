import { describe, expect, it } from "vitest";

import { dailyNotePath, renderTemplate } from "./templates";

describe("vault templates", () => {
  it("renders deterministic local variables", () => {
    expect(
      renderTemplate("# {{title}}\n{{date}} {{time}}", {
        date: new Date(2026, 7, 24, 9, 5),
        title: "Journal",
      }),
    ).toBe("# Journal\n2026-08-24 09:05");
  });

  it("builds a safe daily note path", () => {
    expect(
      dailyNotePath(new Date(2026, 7, 24, 9, 5), "Daily/YYYY-MM-DD.md"),
    ).toBe("Daily/2026-08-24.md");
    expect(() => dailyNotePath(new Date(), "../outside.md")).toThrow(
      "Invalid daily note path",
    );
  });
});
