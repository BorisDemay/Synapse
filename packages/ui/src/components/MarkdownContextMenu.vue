<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import type { MarkdownMenuGroup } from "../markdown/editor-tools";
import { flattenMenuCommands } from "../markdown/editor-tools";

const MENU_ICON_PATHS: Readonly<Record<string, string>> = {
  bold: "M7 5h6a3 3 0 0 1 0 6H7zm0 6h7a3 3 0 0 1 0 6H7z",
  italic: "M14 5h4M6 19h4M14 5 10 19",
  strike:
    "M5 12h14M15 7.5A4 4 0 0 0 11.5 6C9.5 6 8 7 8 8.5c0 1.3 1.2 2 4 2.7 2.8.7 4 1.4 4 2.8 0 1.6-1.6 2.8-4 2.8a4.8 4.8 0 0 1-4-2",
  "inline-code": "m8 9-3 3 3 3m8-6 3 3-3 3m-3-7-4 14",
  code: "M9 5H5v14h4M15 5h4v14h-4M10 9h4M10 12h4M10 15h4",
  link: "M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1",
  emoji:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 10h.01M15.5 10h.01M8 14s1.5 2 4 2 4-2 4-2",
  undo: "m9 14-4-4 4-4M5 10h8a5 5 0 0 1 5 5v1",
  redo: "m15 14 4-4-4-4m4 0h-8a5 5 0 0 0-5 5v1",
  copy: "M8 8h10v11H8zM6 5h10v3M6 5v11h2",
  cut: "m6 6 12 12m0-12L6 18M7 7a2 2 0 1 0-2-2 2 2 0 0 0 2 2Zm12 12a2 2 0 1 0-2-2 2 2 0 0 0 2 2Z",
  paste: "M9 5h6M10 3h4v4h-4zM7 5H5v16h14V5h-2M9 12h6M9 16h4",
  "row-add-above": "M5 5h14v14H5zM5 10h14M12 2v6M9 5h6",
  "row-add": "M5 5h14v14H5zM5 14h14m-7 2v6m-3-3h6",
  "column-add-before": "M5 5h14v14H5zm5 0v14M2 12h6M5 9v6",
  "column-add": "M5 5h14v14H5zm9 0v14m2-7h6m-3-3v6",
  "row-delete": "M5 5h14v14H5zm0 9h14m-4-12 4 4m0-4-4 4",
  "column-delete": "M5 5h14v14H5zm9 0v14m-1-4 4 4m0-4-4 4",
  default: "M5 5h14v14H5z",
};

const props = defineProps<{
  groups: readonly MarkdownMenuGroup[];
  open: boolean;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  close: [];
  select: [id: string];
}>();

const menu = ref<HTMLElement>();
const activeIndex = ref(0);
const left = ref(0);
const top = ref(0);

const commands = computed(() => flattenMenuCommands(props.groups));

function closeMenu() {
  emit("close");
}

function selectCommand(id: string) {
  emit("select", id);
  closeMenu();
}

function commandIndex(id: string) {
  return commands.value.findIndex((item) => item.id === id);
}

function iconPath(id: string) {
  return MENU_ICON_PATHS[id] ?? MENU_ICON_PATHS.default;
}

function focusCommand(id: string, event: Event) {
  activeIndex.value = commandIndex(id);
  if (event.currentTarget instanceof HTMLButtonElement) {
    event.currentTarget.focus({ preventScroll: true });
  }
}

async function placeMenu() {
  await nextTick();
  const node = menu.value;
  if (!node) {
    return;
  }

  const margin = 8;
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  left.value = Math.max(
    margin,
    Math.min(props.x, window.innerWidth - width - margin),
  );
  top.value = Math.max(
    margin,
    Math.min(props.y, window.innerHeight - height - margin),
  );
}

async function focusActiveItem() {
  await nextTick();
  const items =
    menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
  items?.[activeIndex.value]?.focus();
}

function moveActive(delta: number) {
  const count = commands.value.length;
  if (count === 0) {
    return;
  }
  activeIndex.value = (activeIndex.value + delta + count) % count;
  void focusActiveItem();
}

function onMenuKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeMenu();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveActive(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveActive(-1);
    return;
  }
  if (event.key === "Home") {
    event.preventDefault();
    activeIndex.value = 0;
    void focusActiveItem();
    return;
  }
  if (event.key === "End") {
    event.preventDefault();
    activeIndex.value = Math.max(0, commands.value.length - 1);
    void focusActiveItem();
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    moveActive(event.shiftKey ? -1 : 1);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    const command = commands.value[activeIndex.value];
    if (command) {
      selectCommand(command.id);
    }
  }
}

function onDocumentPointerDown(event: Event) {
  if (!menu.value?.contains(event.target as Node)) {
    closeMenu();
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    closeMenu();
  }
}

function onViewportChange() {
  // The menu is anchored to the pointer position in the viewport, not to a
  // moving element, so scrolling content underneath is harmless; only a
  // viewport resize can push the clamped position off-screen.
  closeMenu();
}

function bindDismissListeners() {
  document.addEventListener("mousedown", onDocumentPointerDown, true);
  window.addEventListener("keydown", onDocumentKeydown);
  window.addEventListener("resize", onViewportChange);
}

function unbindDismissListeners() {
  document.removeEventListener("mousedown", onDocumentPointerDown, true);
  window.removeEventListener("keydown", onDocumentKeydown);
  window.removeEventListener("resize", onViewportChange);
}

watch(
  () => [props.open, props.x, props.y, props.groups] as const,
  async ([open]) => {
    unbindDismissListeners();
    if (!open) {
      return;
    }
    activeIndex.value = 0;
    left.value = props.x;
    top.value = props.y;
    bindDismissListeners();
    await placeMenu();
    await focusActiveItem();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  unbindDismissListeners();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menu"
      aria-label="Outils Markdown"
      class="synapse-markdown-context-menu"
      role="menu"
      tabindex="-1"
      :style="{ left: `${left}px`, top: `${top}px` }"
      @contextmenu.prevent
      @keydown="onMenuKeydown"
    >
      <section
        v-for="group in groups"
        :key="group.id"
        class="synapse-markdown-context-group"
        role="none"
      >
        <template
          v-for="(item, index) in group.items"
          :key="`${group.id}-${index}`"
        >
          <div
            v-if="item.type === 'separator'"
            class="synapse-markdown-context-separator"
            role="separator"
          />
          <button
            v-else
            :class="{
              'synapse-markdown-context-item--destructive': item.destructive,
              'synapse-markdown-context-item--active':
                commandIndex(item.id) === activeIndex,
            }"
            class="synapse-markdown-context-item"
            role="menuitem"
            type="button"
            :aria-checked="
              item.checked === undefined ? undefined : item.checked
            "
            @click="selectCommand(item.id)"
            @pointerenter="focusCommand(item.id, $event)"
          >
            <svg
              aria-hidden="true"
              class="synapse-markdown-context-item-icon"
              fill="none"
              focusable="false"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.75"
              viewBox="0 0 24 24"
            >
              <path :d="iconPath(item.id)" />
            </svg>
            <span>{{ item.label }}</span>
          </button>
        </template>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.synapse-markdown-context-menu {
  position: fixed;
  z-index: 1100;
  display: grid;
  min-width: 12rem;
  max-width: min(18rem, calc(100vw - 1rem));
  max-height: min(22rem, calc(100vh - 1rem));
  overflow: auto;
  padding: 0.2rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: calc(var(--synapse-radius-sm) - 0.1rem);
  background: var(--synapse-color-surface-raised);
  box-shadow: var(--synapse-shadow-md);
}

.synapse-markdown-context-group + .synapse-markdown-context-group {
  margin-top: 0.15rem;
  padding-top: 0.15rem;
  border-top: 1px solid var(--synapse-color-border);
}

.synapse-markdown-context-item {
  display: grid;
  grid-template-columns: 1rem minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.35rem 0.5rem;
  border: 0;
  border-radius: calc(var(--synapse-radius-sm) - 0.25rem);
  color: var(--synapse-color-text);
  background: transparent;
  font: inherit;
  font-size: 0.8rem;
  line-height: 1.25;
  text-align: start;
  cursor: pointer;
}

.synapse-markdown-context-item-icon {
  width: 1rem;
  height: 1rem;
}

.synapse-markdown-context-item--active,
.synapse-markdown-context-item:hover {
  background: var(--synapse-color-surface-muted);
}

.synapse-markdown-context-item:focus-visible {
  outline: 2px solid var(--synapse-color-accent);
  outline-offset: -2px;
}

.synapse-markdown-context-item--destructive {
  color: var(--synapse-color-danger);
}

.synapse-markdown-context-separator {
  height: 1px;
  margin: 0.2rem;
  background: var(--synapse-color-border);
}
</style>
