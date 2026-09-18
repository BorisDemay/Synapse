<script setup lang="ts">
import { usePanelLayout } from "../panel-resize";
import PanelResizeHandle from "./PanelResizeHandle.vue";

withDefaults(
  defineProps<{
    sidebarCollapsed?: boolean;
  }>(),
  {
    sidebarCollapsed: false,
  },
);

const { cssVars, resizing } = usePanelLayout();
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'app-shell--sidebar-collapsed': sidebarCollapsed,
      'app-shell--resizing': resizing,
    }"
    :style="cssVars"
  >
    <aside
      id="app-shell-sidebar"
      class="app-shell-sidebar"
      :aria-label="
        sidebarCollapsed
          ? 'Navigation du coffre (mini-rail)'
          : 'Navigation du coffre'
      "
    >
      <slot name="navigation" />
      <PanelResizeHandle v-if="!sidebarCollapsed" panel="sidebar" edge="end" />
    </aside>
    <main class="app-shell-content">
      <slot />
    </main>
    <aside
      v-if="$slots.relations"
      id="app-shell-relations"
      class="app-shell-relations"
      aria-label="Relations de la note"
    >
      <PanelResizeHandle panel="relations" edge="start" />
      <slot name="relations" />
    </aside>
    <aside
      v-if="$slots.assistantHistory"
      id="app-shell-assistant-history"
      class="app-shell-assistant-history"
      aria-label="Conversations Codex"
    >
      <PanelResizeHandle panel="assistantHistory" edge="start" />
      <slot name="assistantHistory" />
    </aside>
    <aside
      v-if="$slots.assistant"
      id="app-shell-assistant"
      class="app-shell-assistant"
      aria-label="Assistant d'écriture"
    >
      <PanelResizeHandle panel="assistant" edge="start" />
      <slot name="assistant" />
    </aside>
  </div>
</template>
