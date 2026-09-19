<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";

import { SUBMENU_CHEVRON_PATH, menuIconPath } from "../markdown/editor-icons";
import type {
  MarkdownMenuCommand,
  MarkdownMenuItem,
  MarkdownMenuSubmenu,
} from "../markdown/editor-tools";

const props = defineProps<{
  isSubmenu?: boolean;
  items: readonly MarkdownMenuItem[];
  label: string;
}>();

const emit = defineEmits<{
  close: [];
  "hover-command": [];
  "open-submenu": [id: string, anchor: HTMLElement];
  select: [id: string];
}>();

const panel = ref<HTMLElement>();
const activeIndex = ref(0);

// Focusable entries: commands and submenus, in render order. Separators are
// skipped by the roving index.
const activables = computed(() =>
  props.items.filter(
    (item): item is MarkdownMenuCommand | MarkdownMenuSubmenu =>
      item.type !== "separator",
  ),
);

function isDisabled(item: MarkdownMenuItem): boolean {
  return item.type === "item" && item.disabled === true;
}

function nextActivable(from: number, delta: number): number {
  const count = activables.value.length;
  if (count === 0) {
    return 0;
  }
  let index = from;
  for (let step = 0; step < count; step += 1) {
    index = (index + delta + count) % count;
    if (!isDisabled(activables.value[index]!)) {
      return index;
    }
  }
  return from;
}

async function focusActiveItem() {
  await nextTick();
  const buttons =
    panel.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
  buttons?.[activeIndex.value]?.focus();
}

function itemButton(index: number): HTMLElement | undefined {
  return panel.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[
    index
  ];
}

function focusItem(
  item: MarkdownMenuCommand | MarkdownMenuSubmenu,
  event: Event,
) {
  const index = activables.value.indexOf(item);
  if (index >= 0) {
    activeIndex.value = index;
  }
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.focus({ preventScroll: true });
  }
  if (item.type === "item") {
    // Hovering a plain command dismisses any submenu opened from a sibling.
    emit("hover-command");
  } else if (
    item.type === "submenu" &&
    event.currentTarget instanceof HTMLElement
  ) {
    // Hovering a submenu entry opens it, like the reference design.
    emit("open-submenu", item.id, event.currentTarget);
  }
}

function openSubmenu(item: MarkdownMenuItem) {
  if (item.type !== "submenu") {
    return;
  }
  const anchor = itemButton(activeIndex.value);
  if (anchor) {
    emit("open-submenu", item.id, anchor);
  }
}

function activate(item: MarkdownMenuItem) {
  if (item.type !== "item") {
    openSubmenu(item);
    return;
  }
  if (isDisabled(item)) {
    return;
  }
  emit("select", item.id);
}

function onPanelKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    // The orchestrator closes one level (submenu first); stop the window
    // handler from closing the whole menu at the same time.
    event.preventDefault();
    event.stopPropagation();
    emit("close");
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeIndex.value = nextActivable(activeIndex.value, 1);
    void focusActiveItem();
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = nextActivable(activeIndex.value, -1);
    void focusActiveItem();
    return;
  }
  if (event.key === "Home") {
    event.preventDefault();
    activeIndex.value = nextActivable(-1, 1);
    void focusActiveItem();
    return;
  }
  if (event.key === "End") {
    event.preventDefault();
    activeIndex.value = nextActivable(activables.value.length, -1);
    void focusActiveItem();
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    activeIndex.value = nextActivable(
      activeIndex.value,
      event.shiftKey ? -1 : 1,
    );
    void focusActiveItem();
    return;
  }
  if (event.key === "ArrowRight") {
    const item = activables.value[activeIndex.value];
    if (item?.type === "submenu") {
      event.preventDefault();
      openSubmenu(item);
    }
    return;
  }
  if (event.key === "ArrowLeft") {
    if (props.isSubmenu) {
      event.preventDefault();
      emit("close");
    }
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    const item = activables.value[activeIndex.value];
    if (item) {
      activate(item);
    }
  }
}

function isHeading(item: MarkdownMenuItem): boolean {
  return item.type === "item" && /^h[1-6]$/u.test(item.id);
}

function headingLabel(item: MarkdownMenuItem): string {
  return item.type === "item" ? item.id.toUpperCase() : "";
}

onMounted(() => {
  void focusActiveItem();
});

defineExpose({
  rootEl: panel,
});
</script>

<template>
  <div
    ref="panel"
    :aria-label="label"
    class="synapse-markdown-context-menu"
    role="menu"
    tabindex="-1"
    @contextmenu.prevent
    @keydown="onPanelKeydown"
  >
    <template v-for="(item, index) in items" :key="`${index}-${item.type}`">
      <div
        v-if="item.type === 'separator'"
        class="synapse-markdown-context-separator"
        role="separator"
      />
      <button
        v-else
        :aria-checked="item.type === 'item' ? item.checked : undefined"
        :aria-disabled="
          item.type === 'item' && item.disabled ? 'true' : undefined
        "
        :aria-haspopup="item.type === 'submenu' ? 'true' : undefined"
        :class="{
          'synapse-markdown-context-item--destructive':
            item.type === 'item' && item.destructive,
          'synapse-markdown-context-item--disabled':
            item.type === 'item' && item.disabled,
          'synapse-markdown-context-item--active': index === activeIndex,
        }"
        class="synapse-markdown-context-item"
        role="menuitem"
        type="button"
        @click="activate(item)"
        @pointerenter="focusItem(item, $event)"
      >
        <span
          v-if="isHeading(item)"
          aria-hidden="true"
          class="synapse-markdown-context-item-icon synapse-markdown-context-item-icon--text"
          >{{ headingLabel(item) }}</span
        >
        <svg
          v-else
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
          <path :d="menuIconPath(item.id)" />
        </svg>
        <span class="synapse-markdown-context-item-label">{{
          item.label
        }}</span>
        <svg
          v-if="item.type === 'submenu'"
          aria-hidden="true"
          class="synapse-markdown-context-item-chevron"
          fill="none"
          focusable="false"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.75"
          viewBox="0 0 24 24"
        >
          <path :d="SUBMENU_CHEVRON_PATH" />
        </svg>
        <span
          v-else-if="item.type === 'item' && item.checked"
          aria-hidden="true"
          class="synapse-markdown-context-item-check"
          >✓</span
        >
      </button>
    </template>
  </div>
</template>

<style scoped>
.synapse-markdown-context-menu {
  position: fixed;
  z-index: 1100;
  display: grid;
  min-width: 12rem;
  max-width: min(18rem, calc(100vw - 1rem));
  max-height: min(24rem, calc(100vh - 1rem));
  overflow: auto;
  padding: 0.2rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: calc(var(--synapse-radius-sm) - 0.1rem);
  background: var(--synapse-color-surface-raised);
  box-shadow: var(--synapse-shadow-md);
}

.synapse-markdown-context-item {
  display: grid;
  grid-template-columns: 1rem minmax(0, 1fr) auto;
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

.synapse-markdown-context-item--text {
  align-self: center;
  justify-self: center;
  width: auto;
  height: auto;
  color: var(--synapse-color-text-muted);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.02em;
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

.synapse-markdown-context-item--disabled {
  color: var(--synapse-color-text-muted);
  cursor: default;
}

.synapse-markdown-context-item-chevron,
.synapse-markdown-context-item-check {
  width: 0.9rem;
  height: 0.9rem;
  color: var(--synapse-color-text-muted);
}

.synapse-markdown-context-item-check {
  width: auto;
  height: auto;
  font-size: 0.8rem;
  font-weight: 600;
}

.synapse-markdown-context-separator {
  height: 1px;
  margin: 0.2rem;
  background: var(--synapse-color-border);
}
</style>
