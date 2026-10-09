import { getCurrentInstance, onMounted, ref } from "vue";

const COLLAPSED_KEY = "synapse-ui-sidebar-collapsed";
const COMPACT_KEY = "synapse-ui-sidebar-compact";

const collapsed = ref(false);
const compact = ref(false);
let initialized = false;

function readBoolean(key: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(key) === "true";
}

function persistBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, value ? "true" : "false");
}

export function resetSidebarLayoutState() {
  collapsed.value = false;
  compact.value = false;
  initialized = false;
}

export function initializeSidebarLayout() {
  if (typeof window === "undefined" || initialized) {
    return;
  }
  collapsed.value = readBoolean(COLLAPSED_KEY);
  compact.value = readBoolean(COMPACT_KEY);
  initialized = true;
}

export function useSidebarLayout() {
  initializeSidebarLayout();

  if (getCurrentInstance()) {
    onMounted(() => {
      initializeSidebarLayout();
    });
  }

  function setCollapsed(value: boolean) {
    collapsed.value = value;
    persistBoolean(COLLAPSED_KEY, value);
  }

  function setCompact(value: boolean) {
    compact.value = value;
    persistBoolean(COMPACT_KEY, value);
  }

  function toggleCollapsed() {
    setCollapsed(!collapsed.value);
  }

  function toggleCompact() {
    setCompact(!compact.value);
  }

  return {
    collapsed,
    compact,
    setCollapsed,
    setCompact,
    toggleCollapsed,
    toggleCompact,
  };
}
