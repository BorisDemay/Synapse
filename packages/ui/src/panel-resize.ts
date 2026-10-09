import { computed, getCurrentInstance, onMounted, reactive, ref } from "vue";

export type PanelId =
  | "sidebar"
  | "relations"
  | "assistantHistory"
  | "assistant";

export type ResizeEdge = "start" | "end";

export const PANEL_WIDTH_STORAGE_KEY = "synapse-ui-panel-widths";

export const PANEL_WIDTH_BOUNDS = {
  sidebar: { default: 272, min: 192, max: 512 },
  relations: { default: 256, min: 180, max: 448 },
  assistantHistory: { default: 256, min: 180, max: 400 },
  assistant: { default: 384, min: 280, max: 720 },
} as const;

export const PANEL_ASIDE_IDS: Record<PanelId, string> = {
  sidebar: "app-shell-sidebar",
  relations: "app-shell-relations",
  assistantHistory: "app-shell-assistant-history",
  assistant: "app-shell-assistant",
};

export const PANEL_RESIZE_LABELS: Record<PanelId, string> = {
  sidebar: "Redimensionner la navigation",
  relations: "Redimensionner les relations",
  assistantHistory: "Redimensionner les conversations",
  assistant: "Redimensionner l'assistant",
};

export const PANEL_CSS_VARS: Record<PanelId, string> = {
  sidebar: "--app-shell-sidebar-width-expanded",
  relations: "--app-shell-relations-width",
  assistantHistory: "--app-shell-assistant-history-width",
  assistant: "--app-shell-assistant-width",
};

const PANEL_IDS = Object.keys(PANEL_WIDTH_BOUNDS) as PanelId[];

type PanelWidths = Record<PanelId, number>;

function defaultWidths(): PanelWidths {
  return {
    sidebar: PANEL_WIDTH_BOUNDS.sidebar.default,
    relations: PANEL_WIDTH_BOUNDS.relations.default,
    assistantHistory: PANEL_WIDTH_BOUNDS.assistantHistory.default,
    assistant: PANEL_WIDTH_BOUNDS.assistant.default,
  };
}

const widths = reactive<PanelWidths>(defaultWidths());
const resizing = ref(false);
let initialized = false;

export function clampPanelWidth(panel: PanelId, px: number): number {
  const bounds = PANEL_WIDTH_BOUNDS[panel];
  if (!Number.isFinite(px)) {
    return bounds.default;
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(px)));
}

export function widthFromPointerDelta({
  startWidth,
  deltaX,
  edge,
  rtl,
}: {
  startWidth: number;
  deltaX: number;
  edge: ResizeEdge;
  rtl: boolean;
}): number {
  const direction = (edge === "end" ? 1 : -1) * (rtl ? -1 : 1);
  return startWidth + direction * deltaX;
}

function readStoredWidths(): PanelWidths {
  const next = defaultWidths();
  if (typeof window === "undefined") {
    return next;
  }
  const raw = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
  if (!raw) {
    return next;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<PanelId, unknown>>;
    for (const panel of PANEL_IDS) {
      const value = parsed[panel];
      if (typeof value === "number") {
        next[panel] = clampPanelWidth(panel, value);
      }
    }
  } catch {
    return defaultWidths();
  }
  return next;
}

function persistWidths() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    PANEL_WIDTH_STORAGE_KEY,
    JSON.stringify({
      sidebar: widths.sidebar,
      relations: widths.relations,
      assistantHistory: widths.assistantHistory,
      assistant: widths.assistant,
    }),
  );
}

export function resetPanelLayoutState() {
  Object.assign(widths, defaultWidths());
  resizing.value = false;
  initialized = false;
}

export function initializePanelLayout() {
  if (typeof window === "undefined" || initialized) {
    return;
  }
  Object.assign(widths, readStoredWidths());
  initialized = true;
}

export function usePanelLayout() {
  initializePanelLayout();

  if (getCurrentInstance()) {
    onMounted(() => {
      initializePanelLayout();
    });
  }

  function setPanelWidth(panel: PanelId, px: number, persist = false) {
    widths[panel] = clampPanelWidth(panel, px);
    if (persist) {
      persistWidths();
    }
  }

  function resetPanelWidth(panel: PanelId) {
    setPanelWidth(panel, PANEL_WIDTH_BOUNDS[panel].default, true);
  }

  function beginResize() {
    resizing.value = true;
  }

  function endResize() {
    resizing.value = false;
    persistWidths();
  }

  const cssVars = computed(() => ({
    "--app-shell-sidebar-width-expanded": `${widths.sidebar}px`,
    "--app-shell-relations-width": `${widths.relations}px`,
    "--app-shell-assistant-history-width": `${widths.assistantHistory}px`,
    "--app-shell-assistant-width": `${widths.assistant}px`,
  }));

  return {
    widths,
    cssVars,
    resizing,
    setPanelWidth,
    resetPanelWidth,
    beginResize,
    endResize,
  };
}
