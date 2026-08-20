import { getCurrentInstance, onMounted, ref } from "vue";

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "synapse-ui-theme";
const themeMode = ref<ThemeMode>("light");
function preferredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") {
    return saved;
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
    ? "dark"
    : "light";
}

function applyTheme(mode: ThemeMode) {
  themeMode.value = mode;
  document.documentElement.classList.toggle("synapse-dark", mode === "dark");
  document.documentElement.style.colorScheme = mode;
}

export function initializeTheme() {
  if (typeof document === "undefined") {
    return;
  }

  applyTheme(preferredTheme());
}

export function useTheme() {
  initializeTheme();

  if (getCurrentInstance()) {
    onMounted(() => {
      initializeTheme();
    });
  }

  function setTheme(mode: ThemeMode) {
    applyTheme(mode);
    window.localStorage.setItem(STORAGE_KEY, mode);
  }

  function toggleTheme() {
    setTheme(themeMode.value === "dark" ? "light" : "dark");
  }

  return {
    mode: themeMode,
    setTheme,
    toggleTheme,
  };
}
