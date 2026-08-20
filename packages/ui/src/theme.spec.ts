import { beforeEach, describe, expect, it } from "vitest";

import { initializeTheme, useTheme } from "./theme";

describe("theme preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("synapse-dark");
    document.documentElement.style.colorScheme = "";
  });

  it("toggles the document theme and persists only the UI preference", () => {
    initializeTheme();
    const theme = useTheme();

    theme.setTheme("dark");

    expect(theme.mode.value).toBe("dark");
    expect(document.documentElement.classList.contains("synapse-dark")).toBe(
      true,
    );
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem("synapse-ui-theme")).toBe("dark");
  });

  it("restores a saved preference without exposing vault material", () => {
    window.localStorage.setItem("synapse-ui-theme", "dark");
    initializeTheme();

    const theme = useTheme();

    expect(theme.mode.value).toBe("dark");
    expect(window.localStorage.getItem("synapse-ui-theme")).toBe("dark");
    expect(window.localStorage.getItem("vault-key")).toBeNull();
  });
});
