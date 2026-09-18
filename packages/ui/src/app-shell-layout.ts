import { getCurrentInstance, onMounted, onUnmounted, ref, type Ref } from "vue";

export const COMPACT_ASSISTANT_MEDIA_QUERY = "(max-width: 75rem)";

const isCompact = ref(false);
let initialized = false;
let mediaQuery: MediaQueryList | undefined;
const boundPanels = new Set<{
  historyOpen: Ref<boolean>;
  relationsOpen: Ref<boolean>;
}>();

function collapseBoundSidePanels() {
  for (const panels of boundPanels) {
    panels.historyOpen.value = false;
    panels.relationsOpen.value = false;
  }
}

function syncCompactState(matches: boolean) {
  const wasCompact = isCompact.value;
  isCompact.value = matches;
  if (matches && !wasCompact) {
    collapseBoundSidePanels();
  }
}

export function readCompactAssistantViewport(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia(COMPACT_ASSISTANT_MEDIA_QUERY).matches;
}

export function defaultAssistantSidePanelsOpen(): {
  history: boolean;
  relations: boolean;
} {
  const compact = readCompactAssistantViewport();
  return {
    history: !compact,
    relations: !compact,
  };
}

export function resetCompactAssistantLayoutState() {
  isCompact.value = false;
  initialized = false;
  mediaQuery = undefined;
  boundPanels.clear();
}

function initializeCompactAssistantLayout() {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    initialized
  ) {
    return;
  }
  mediaQuery = window.matchMedia(COMPACT_ASSISTANT_MEDIA_QUERY);
  syncCompactState(mediaQuery.matches);
  mediaQuery.addEventListener("change", onMediaQueryChange);
  initialized = true;
}

function onMediaQueryChange(event: MediaQueryListEvent) {
  syncCompactState(event.matches);
}

export function useCompactAssistantLayout() {
  initializeCompactAssistantLayout();

  if (getCurrentInstance()) {
    onMounted(() => {
      initializeCompactAssistantLayout();
      syncCompactState(readCompactAssistantViewport());
    });
  }

  function bindSidePanels(panels: {
    historyOpen: Ref<boolean>;
    relationsOpen: Ref<boolean>;
  }) {
    boundPanels.add(panels);

    if (getCurrentInstance()) {
      onMounted(() => {
        if (isCompact.value) {
          panels.historyOpen.value = false;
          panels.relationsOpen.value = false;
        }
      });
      onUnmounted(() => {
        boundPanels.delete(panels);
      });
    } else if (isCompact.value) {
      panels.historyOpen.value = false;
      panels.relationsOpen.value = false;
    }

    return () => {
      boundPanels.delete(panels);
    };
  }

  return {
    bindSidePanels,
    isCompact,
  };
}
