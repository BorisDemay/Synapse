<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import {
  useCompactAssistantLayout,
  useCompactNavigationLayout,
} from "../app-shell-layout";
import {
  DialogFocusController,
  getDialogFocusableElements,
} from "../dialog-focus";
import { usePanelLayout } from "../panel-resize";
import PanelResizeHandle from "./PanelResizeHandle.vue";

const props = withDefaults(
  defineProps<{
    sidebarCollapsed?: boolean;
    toolOpen?: boolean;
  }>(),
  { sidebarCollapsed: false, toolOpen: false },
);
const emit = defineEmits<{ closeTool: [] }>();

const { cssVars, resizing } = usePanelLayout();
const { isNavigationCompact } = useCompactNavigationLayout();
const { isCompact } = useCompactAssistantLayout();
const toolOverlay = computed(() => isCompact.value && props.toolOpen);
const relationsElement = ref<HTMLElement>();
const conversationsElement = ref<HTMLElement>();
const assistantElement = ref<HTMLElement>();
const toolElement = computed(
  () =>
    assistantElement.value ??
    relationsElement.value ??
    conversationsElement.value,
);
const toolFocus = new DialogFocusController({
  getContainer: () => toolElement.value ?? null,
  onEscape: () => emit("closeTool"),
});
watch(
  [toolOverlay, toolElement],
  async ([open]) => {
    toolFocus.detach();
    if (open) {
      await nextTick();
      if (toolOverlay.value) toolFocus.attach();
    }
  },
  { flush: "post" },
);
onBeforeUnmount(() => toolFocus.detach());

const navigationOpen = ref(false);
const sidebarElement = ref<HTMLElement | null>(null);
const toggleElement = ref<HTMLButtonElement | null>(null);
let lastFocusedElement: HTMLElement | null = null;

const sidebarInert = computed(
  () =>
    toolOverlay.value || (isNavigationCompact.value && !navigationOpen.value),
);
const backgroundInert = computed(() =>
  isNavigationCompact.value && navigationOpen.value ? true : undefined,
);

watch(isNavigationCompact, (compact) => {
  if (!compact && navigationOpen.value) {
    navigationOpen.value = false;
    lastFocusedElement = null;
  }
});

async function openNavigation() {
  if (!isNavigationCompact.value || navigationOpen.value) {
    return;
  }
  lastFocusedElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  navigationOpen.value = true;
  await nextTick();
  if (navigationOpen.value) {
    sidebarElement.value?.focus();
  }
}

async function closeNavigation() {
  if (!navigationOpen.value) {
    return;
  }
  navigationOpen.value = false;
  await nextTick();
  const target = lastFocusedElement ?? toggleElement.value;
  lastFocusedElement = null;
  target?.focus();
}

function toggleNavigation() {
  if (navigationOpen.value) {
    void closeNavigation();
  } else {
    void openNavigation();
  }
}

function onDrawerKeydown(event: KeyboardEvent) {
  if (!navigationOpen.value) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    void closeNavigation();
    return;
  }
  if (event.key !== "Tab") {
    return;
  }
  const container = sidebarElement.value;
  if (!container) {
    return;
  }
  const focusables = getDialogFocusableElements(container);
  if (focusables.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const active = document.activeElement;
  const inside = active instanceof Node && container.contains(active);
  if (event.shiftKey && (!inside || active === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}

defineExpose({
  closeNavigation,
});
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'app-shell--sidebar-collapsed': sidebarCollapsed,
      'app-shell--resizing': resizing,
      'app-shell--navigation-drawer': isNavigationCompact,
      'app-shell--navigation-drawer-open': navigationOpen,
    }"
    :style="cssVars"
  >
    <button
      ref="toggleElement"
      class="app-shell-nav-toggle"
      type="button"
      :inert="toolOverlay || undefined"
      :aria-expanded="navigationOpen ? 'true' : 'false'"
      aria-controls="app-shell-sidebar"
      :aria-label="
        navigationOpen ? 'Fermer la navigation' : 'Ouvrir la navigation'
      "
      @click="toggleNavigation"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z"
        />
      </svg>
    </button>
    <aside
      id="app-shell-sidebar"
      ref="sidebarElement"
      class="app-shell-sidebar"
      tabindex="-1"
      :role="navigationOpen ? 'dialog' : undefined"
      :aria-modal="navigationOpen ? true : undefined"
      :aria-label="
        sidebarCollapsed
          ? 'Navigation du coffre (mini-rail)'
          : 'Navigation du coffre'
      "
      :inert="sidebarInert || undefined"
      @keydown="onDrawerKeydown"
    >
      <button
        v-if="navigationOpen"
        class="app-shell-nav-close"
        type="button"
        aria-label="Fermer la navigation"
        @click="closeNavigation()"
      >
        ×
      </button>
      <slot name="navigation" />
      <PanelResizeHandle v-if="!sidebarCollapsed" panel="sidebar" edge="end" />
    </aside>
    <main
      class="app-shell-content"
      :inert="backgroundInert || toolOverlay || undefined"
    >
      <slot />
    </main>
    <aside
      v-if="$slots.relations"
      id="app-shell-relations"
      ref="relationsElement"
      class="app-shell-relations"
      tabindex="-1"
      :role="toolOverlay ? 'dialog' : undefined"
      :aria-modal="toolOverlay || undefined"
      aria-label="Relations de la note"
      :inert="backgroundInert"
    >
      <PanelResizeHandle panel="relations" edge="start" />
      <slot name="relations" />
    </aside>
    <aside
      v-if="$slots.assistantHistory"
      id="app-shell-assistant-history"
      ref="conversationsElement"
      class="app-shell-assistant-history"
      tabindex="-1"
      :role="toolOverlay ? 'dialog' : undefined"
      :aria-modal="toolOverlay || undefined"
      aria-label="Conversations de l’assistant"
      :inert="backgroundInert"
    >
      <PanelResizeHandle panel="assistantHistory" edge="start" />
      <slot name="assistantHistory" />
    </aside>
    <aside
      v-if="$slots.assistant"
      id="app-shell-assistant"
      ref="assistantElement"
      class="app-shell-assistant"
      tabindex="-1"
      :role="toolOverlay ? 'dialog' : undefined"
      :aria-modal="toolOverlay || undefined"
      aria-label="Assistant d'écriture"
      :inert="backgroundInert"
    >
      <PanelResizeHandle panel="assistant" edge="start" />
      <slot name="assistant" />
    </aside>
    <div
      v-if="toolOverlay"
      class="app-shell-tool-backdrop"
      aria-hidden="true"
      @click="emit('closeTool')"
    />
    <div
      v-if="navigationOpen"
      class="app-shell-backdrop"
      aria-hidden="true"
      @click="closeNavigation()"
    />
  </div>
</template>
