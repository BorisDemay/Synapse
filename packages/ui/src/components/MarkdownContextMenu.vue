<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import type { MarkdownMenuGroup } from "../markdown/editor-tools";
import { flattenMenuCommands } from "../markdown/editor-tools";

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
      >
        <p class="synapse-markdown-context-group-label" role="presentation">
          {{ group.label }}
        </p>
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
            @pointerenter="activeIndex = commandIndex(item.id)"
          >
            {{ item.label }}
          </button>
        </template>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.synapse-markdown-context-menu {
  position: fixed;
  z-index: 20;
  display: grid;
  min-width: 15rem;
  max-width: min(22rem, calc(100vw - 1rem));
  max-height: min(28rem, calc(100vh - 1rem));
  overflow: auto;
  padding: 0.3rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: 0.5rem;
  background: var(--synapse-color-surface-raised);
  box-shadow: 0 8px 24px rgb(0 0 0 / 20%);
}

.synapse-markdown-context-group + .synapse-markdown-context-group {
  margin-top: 0.2rem;
  padding-top: 0.2rem;
  border-top: 1px solid var(--synapse-color-border);
}

.synapse-markdown-context-group-label {
  margin: 0.2rem 0.45rem 0.15rem;
  color: var(--synapse-color-text-muted);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.synapse-markdown-context-item {
  width: 100%;
  padding: 0.45rem 0.65rem;
  border: 0;
  border-radius: 0.3rem;
  color: var(--synapse-color-text);
  background: transparent;
  font: inherit;
  font-size: 0.82rem;
  text-align: start;
  cursor: pointer;
}

.synapse-markdown-context-item--active,
.synapse-markdown-context-item:hover,
.synapse-markdown-context-item:focus-visible {
  background: color-mix(in srgb, var(--synapse-color-accent) 12%, transparent);
  outline: none;
}

.synapse-markdown-context-item--destructive {
  color: var(--synapse-color-danger, #b42318);
}

.synapse-markdown-context-separator {
  height: 1px;
  margin: 0.25rem;
  background: var(--synapse-color-border);
}
</style>
