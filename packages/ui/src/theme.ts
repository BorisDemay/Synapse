import { getCurrentInstance, onMounted, ref } from "vue";

export type ThemeMode = "light" | "dark";
export type ThemePreference = ThemeMode | "system";

const STORAGE_KEY = "synapse-ui-theme";
const SYSTEM_QUERY = "(prefers-color-scheme: dark)";

const themeMode = ref<ThemeMode>("light");
const themePreference = ref<ThemePreference>("system");

let mediaQuery: MediaQueryList | undefined;
let mediaBound = false;

function systemTheme(): ThemeMode {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "light";
  }

  return window.matchMedia(SYSTEM_QUERY).matches ? "dark" : "light";
}

function readPreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light" || saved === "system") {
    return saved;
  }

  return "system";
}

function resolveTheme(preference: ThemePreference): ThemeMode {
  return preference === "system" ? systemTheme() : preference;
}

function applyTheme(mode: ThemeMode) {
  themeMode.value = mode;
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.toggle("synapse-dark", mode === "dark");
  document.documentElement.style.colorScheme = mode;
}

function applyPreference(preference: ThemePreference) {
  themePreference.value = preference;
  applyTheme(resolveTheme(preference));
}

function onSystemThemeChange() {
  if (themePreference.value === "system") {
    applyTheme(systemTheme());
  }
}

function bindSystemThemeListener() {
  if (
    mediaBound ||
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return;
  }

  mediaQuery = window.matchMedia(SYSTEM_QUERY);
  mediaQuery.addEventListener("change", onSystemThemeChange);
  mediaBound = true;
}

export function resetThemeState() {
  themeMode.value = "light";
  themePreference.value = "system";
  if (mediaQuery) {
    mediaQuery.removeEventListener("change", onSystemThemeChange);
  }
  mediaQuery = undefined;
  mediaBound = false;
}

export function initializeTheme() {
  if (typeof document === "undefined") {
    return;
  }

  applyPreference(readPreference());
  bindSystemThemeListener();
}

export function useTheme() {
  initializeTheme();

  if (getCurrentInstance()) {
    onMounted(() => {
      initializeTheme();
    });
  }

  function persistPreference(preference: ThemePreference) {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, preference);
  }

  function setPreference(preference: ThemePreference) {
    applyPreference(preference);
    persistPreference(preference);
  }

  function setTheme(mode: ThemeMode) {
    setPreference(mode);
  }

  function toggleTheme() {
    setTheme(themeMode.value === "dark" ? "light" : "dark");
  }

  return {
    mode: themeMode,
    preference: themePreference,
    setTheme,
    setPreference,
    toggleTheme,
  };
}
