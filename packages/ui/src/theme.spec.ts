import { beforeEach, describe, expect, it, vi } from "vitest";

import { initializeTheme, resetThemeState, useTheme } from "./theme";

function mockPrefersColorScheme(dark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  window.matchMedia = ((query: string) => {
    const mediaQuery = {
      matches: query.includes("prefers-color-scheme: dark") ? dark : false,
      media: query,
      onchange: null,
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (type === "change" && typeof listener === "function") {
          listeners.add(listener as (event: MediaQueryListEvent) => void);
        }
      },
      removeEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (type === "change" && typeof listener === "function") {
          listeners.delete(listener as (event: MediaQueryListEvent) => void);
        }
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    return mediaQuery;
  }) as typeof window.matchMedia;

  return {
    setDark(next: boolean) {
      dark = next;
      for (const listener of listeners) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
  };
}

describe("theme preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("synapse-dark");
    document.documentElement.style.colorScheme = "";
    resetThemeState();
    mockPrefersColorScheme(false);
  });

  it("toggles the document theme and persists only the UI preference", () => {
    initializeTheme();
    const theme = useTheme();

    theme.setTheme("dark");

    expect(theme.mode.value).toBe("dark");
    expect(theme.preference.value).toBe("dark");
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
    expect(theme.preference.value).toBe("dark");
    expect(window.localStorage.getItem("synapse-ui-theme")).toBe("dark");
    expect(window.localStorage.getItem("vault-key")).toBeNull();
  });

  it("follows the system color scheme when no preference is stored", () => {
    mockPrefersColorScheme(true);
    initializeTheme();

    const theme = useTheme();

    expect(theme.preference.value).toBe("system");
    expect(theme.mode.value).toBe("dark");
    expect(window.localStorage.getItem("synapse-ui-theme")).toBeNull();
  });

  it("persists an explicit system preference and tracks scheme changes", () => {
    const scheme = mockPrefersColorScheme(false);
    initializeTheme();
    const theme = useTheme();

    theme.setPreference("system");

    expect(theme.preference.value).toBe("system");
    expect(theme.mode.value).toBe("light");
    expect(window.localStorage.getItem("synapse-ui-theme")).toBe("system");

    scheme.setDark(true);

    expect(theme.mode.value).toBe("dark");
    expect(theme.preference.value).toBe("system");
    expect(document.documentElement.classList.contains("synapse-dark")).toBe(
      true,
    );
  });

  it("ignores system scheme changes when a light or dark preference is set", () => {
    const scheme = mockPrefersColorScheme(true);
    initializeTheme();
    const theme = useTheme();

    theme.setPreference("light");
    scheme.setDark(true);

    expect(theme.mode.value).toBe("light");
    expect(theme.preference.value).toBe("light");
    expect(document.documentElement.classList.contains("synapse-dark")).toBe(
      false,
    );
  });
});
