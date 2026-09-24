<script setup lang="ts">
import {
  computed,
  nextTick,
  ref,
  watch,
  type ComponentPublicInstance,
} from "vue";

export interface VaultTreeNode {
  children?: VaultTreeNode[];
  id: string;
  kind?: "attachment" | "folder" | "note";
  label: string;
  path?: string;
  syncStatus?: "conflict" | "error" | "offline" | "pending" | "synced";
  tags?: string[];
  updatedAt?: number;
}

const props = defineProps<{
  attachedIds?: string[];
  nested?: boolean;
  nodes: VaultTreeNode[];
  /** External selection (palette, recents, backlinks); the tree follows it. */
  selectedId?: string | null;
}>();

const emit = defineEmits<{
  attach: [id: string];
  delete: [id: string];
  select: [id: string];
}>();

const activeId = ref<string>();
const treeElement = ref<HTMLElement>();
const treeItems = new Map<number, HTMLElement>();
const virtualStart = ref(0);

const ROW_HEIGHT = 56;
const VIRTUAL_WINDOW_SIZE = 80;

const collapsed = ref(new Set<string>());

interface VisibleTreeNode {
  level: number;
  node: VaultTreeNode;
  posInSet: number;
  setSize: number;
}

const visibleNodeCount = computed(() => countVisibleNodes(props.nodes));
const usesVirtualWindow = computed(
  () => !props.nested && visibleNodeCount.value > VIRTUAL_WINDOW_SIZE,
);
const renderedStart = computed(() =>
  usesVirtualWindow.value ? virtualStart.value : 0,
);
const renderedNodes = computed(() =>
  usesVirtualWindow.value
    ? visibleNodesInRange(
        renderedStart.value,
        renderedStart.value + VIRTUAL_WINDOW_SIZE,
      )
    : visibleNodesInRange(0, visibleNodeCount.value),
);
const renderedEnd = computed(
  () => renderedStart.value + renderedNodes.value.length,
);

function setTreeItem(
  element: Element | ComponentPublicInstance | null,
  index: number,
) {
  if (element instanceof HTMLElement) {
    treeItems.set(index, element);
    return;
  }
  treeItems.delete(index);
}

function showIndex(index: number) {
  if (!usesVirtualWindow.value) return;
  if (index < renderedStart.value || index >= renderedEnd.value) {
    virtualStart.value = Math.max(
      0,
      Math.min(index, visibleNodeCount.value - VIRTUAL_WINDOW_SIZE),
    );
    if (treeElement.value) {
      treeElement.value.scrollTop = virtualStart.value * ROW_HEIGHT;
    }
  }
}

function onScroll() {
  if (usesVirtualWindow.value && treeElement.value) {
    virtualStart.value = Math.min(
      Math.floor(treeElement.value.scrollTop / ROW_HEIGHT),
      Math.max(0, visibleNodeCount.value - VIRTUAL_WINDOW_SIZE),
    );
  }
}

function isFolder(node: VaultTreeNode | undefined) {
  return node?.kind === "folder";
}

function findNode(
  nodes: VaultTreeNode[],
  id: string,
): VaultTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = node.children && findNode(node.children, id);
    if (child) return child;
  }
  return undefined;
}

function containsNode(node: VaultTreeNode, id: string): boolean {
  return (
    node.id === id ||
    node.children?.some((child) => containsNode(child, id)) === true
  );
}

function isExpanded(id: string) {
  return !collapsed.value.has(id);
}

function hasExpandedChildren(
  node: VaultTreeNode,
): node is VaultTreeNode & { children: VaultTreeNode[] } {
  return (
    !!node.children?.length &&
    (collapsed.value.size === 0 || isExpanded(node.id))
  );
}

function countVisibleNodes(nodes: VaultTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count++;
    if (hasExpandedChildren(node)) {
      count += countVisibleNodes(node.children);
    }
  }
  return count;
}

function visibleNodesInRange(start: number, end: number): VisibleTreeNode[] {
  const result: VisibleTreeNode[] = [];
  let index = 0;

  function append(nodes: VaultTreeNode[], level: number): boolean {
    for (const [posInSet, node] of nodes.entries()) {
      if (index >= end) return true;
      if (index >= start) {
        result.push({
          level,
          node,
          posInSet: posInSet + 1,
          setSize: nodes.length,
        });
      }
      index++;
      if (hasExpandedChildren(node) && append(node.children, level + 1)) {
        return true;
      }
    }
    return false;
  }

  append(props.nodes, 1);
  return result;
}

function findVisibleNodeIndex(id: string): number {
  let index = 0;

  function visit(nodes: VaultTreeNode[]): number | undefined {
    for (const node of nodes) {
      if (node.id === id) return index;
      index++;
      if (hasExpandedChildren(node)) {
        const childIndex = visit(node.children);
        if (childIndex !== undefined) return childIndex;
      }
    }
    return undefined;
  }

  return visit(props.nodes) ?? -1;
}

const activeIndex = computed(() => {
  if (!activeId.value) return 0;
  const index = findVisibleNodeIndex(activeId.value);
  return index === -1 ? 0 : index;
});

function findTrail(
  nodes: VaultTreeNode[],
  id: string,
  trail: VaultTreeNode[] = [],
): VaultTreeNode[] | undefined {
  for (const node of nodes) {
    const nextTrail = [...trail, node];
    if (node.id === id) return nextTrail;
    if (node.children) {
      const nested = findTrail(node.children, id, nextTrail);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** Follows an external selection: marks it active, expands ancestors and
 * scrolls the virtual window to it without stealing focus. */
async function revealSelected(id: string) {
  const trail = findTrail(props.nodes, id);
  if (!trail) return;
  activeId.value = id;
  if (trail.length > 1) {
    const next = new Set(collapsed.value);
    for (const ancestor of trail.slice(0, -1)) next.delete(ancestor.id);
    collapsed.value = next;
  }
  await nextTick();
  if (id !== activeId.value) return;
  const index = findVisibleNodeIndex(id);
  if (index >= 0) showIndex(index);
}

watch(
  () => props.selectedId,
  (id) => {
    if (id && id !== activeId.value) void revealSelected(id);
  },
  { immediate: true },
);

watch(
  () => visibleNodeCount.value,
  () => {
    virtualStart.value = Math.min(
      virtualStart.value,
      Math.max(0, visibleNodeCount.value - VIRTUAL_WINDOW_SIZE),
    );
  },
);

function toggleFolder(id: string) {
  const folder = findNode(props.nodes, id);
  if (folder && activeId.value && containsNode(folder, activeId.value)) {
    activeId.value = folder.id;
  }
  const next = new Set(collapsed.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  collapsed.value = next;
}

async function select(index: number) {
  const entry = visibleNodesInRange(index, index + 1)[0];
  const node = entry?.node;

  if (!node) {
    return;
  }
  if (isFolder(node)) {
    toggleFolder(node.id);
    return;
  }
  activeId.value = node.id;
  showIndex(index);
  emit("select", node.id);
  await nextTick();
  treeItems.get(index)?.focus();
}

function attach(index: number) {
  const node = visibleNodesInRange(index, index + 1)[0]?.node;
  if (node && !isFolder(node)) {
    emit("attach", node.id);
  }
}

function remove(index: number) {
  const node = visibleNodesInRange(index, index + 1)[0]?.node;
  if (node && !isFolder(node)) {
    emit("delete", node.id);
  }
}

function onDeleteClick(event: MouseEvent, index: number) {
  event.preventDefault();
  event.stopPropagation();
  remove(index);
}

function onItemClick(event: MouseEvent, index: number) {
  if (
    (event.ctrlKey || event.metaKey) &&
    !isFolder(visibleNodesInRange(index, index + 1)[0]?.node)
  ) {
    event.preventDefault();
    attach(index);
    return;
  }
  void select(index);
}

async function selectNext(index: number) {
  await select(index + 1);
}
</script>

<template>
  <div
    v-if="nodes.length === 0 && !nested"
    class="vault-tree-empty"
    role="status"
  >
    <span class="vault-tree-empty-icon" aria-hidden="true">✦</span>
    <strong>Votre coffre est vide</strong>
    <span>Créez votre première note pour commencer.</span>
  </div>
  <ul
    v-else-if="nodes.length"
    ref="treeElement"
    :aria-label="nested ? undefined : 'Notes du coffre'"
    :class="['vault-tree', { 'vault-tree--virtual': usesVirtualWindow }]"
    role="tree"
    @scroll="onScroll"
  >
    <li
      v-if="usesVirtualWindow && renderedStart"
      :style="{ height: `${renderedStart * ROW_HEIGHT}px` }"
      aria-hidden="true"
      role="presentation"
    />
    <li
      v-for="(entry, renderedIndex) in renderedNodes"
      :key="entry.node.id"
      class="vault-tree-item"
      :ref="(element) => setTreeItem(element, renderedStart + renderedIndex)"
      :aria-expanded="
        entry.node.kind === 'folder' ? isExpanded(entry.node.id) : undefined
      "
      :aria-level="entry.level"
      :style="{ '--tree-depth': entry.level - 1 }"
      :aria-posinset="entry.posInSet"
      :aria-selected="renderedStart + renderedIndex === activeIndex"
      :aria-setsize="entry.setSize"
      :data-attached="
        (attachedIds ?? []).includes(entry.node.id) ? 'true' : undefined
      "
      :data-kind="entry.node.kind"
      :data-status="entry.node.syncStatus"
      :data-tree-index="renderedStart + renderedIndex"
      role="treeitem"
      :tabindex="renderedStart + renderedIndex === activeIndex ? 0 : -1"
      @click="onItemClick($event, renderedStart + renderedIndex)"
      @keydown.delete.prevent="remove(renderedStart + renderedIndex)"
      @keydown.down.prevent="selectNext(renderedStart + renderedIndex)"
      @keydown.enter.ctrl.prevent="attach(renderedStart + renderedIndex)"
      @keydown.enter.meta.prevent="attach(renderedStart + renderedIndex)"
    >
      <div class="vault-tree-row">
        <span
          class="vault-tree-kind"
          :data-kind="entry.node.kind ?? 'note'"
          aria-hidden="true"
        >
          <svg
            v-if="entry.node.kind === 'folder'"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <path
              fill="currentColor"
              d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z"
            />
          </svg>
          <svg
            v-else-if="entry.node.kind === 'attachment'"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <path
              fill="currentColor"
              d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5S13.5 3.62 13.5 5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5Z"
            />
          </svg>
          <svg v-else viewBox="0 0 24 24" focusable="false">
            <path
              fill="currentColor"
              d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 2.5L18.5 9H14V4.5ZM8 13h8v2H8v-2Zm0 4h5v2H8v-2Z"
            />
          </svg>
        </span>
        <span
          v-if="entry.node.kind === 'folder'"
          class="vault-tree-disclosure"
          aria-hidden="true"
          >{{ isExpanded(entry.node.id) ? "▾" : "▸" }}</span
        >
        <span class="vault-tree-label">{{ entry.node.label }}</span>
        <button
          v-if="entry.node.kind !== 'folder'"
          class="vault-tree-delete"
          type="button"
          tabindex="-1"
          :aria-label="`Supprimer ${entry.node.label}`"
          @click="onDeleteClick($event, renderedStart + renderedIndex)"
          @mousedown.prevent
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2.25"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M5 7h14M10 7V5.8A1.8 1.8 0 0 1 11.8 4h.4A1.8 1.8 0 0 1 14 5.8V7m-7.2 0 .7 12.1A1.8 1.8 0 0 0 9.3 21h5.4a1.8 1.8 0 0 0 1.8-1.9L17.2 7M10 11v6M14 11v6"
            />
          </svg>
        </button>
      </div>
    </li>
    <li
      v-if="usesVirtualWindow && renderedEnd < visibleNodeCount"
      :style="{
        height: `${(visibleNodeCount - renderedEnd) * ROW_HEIGHT}px`,
      }"
      aria-hidden="true"
      role="presentation"
    />
  </ul>
</template>

<style scoped>
.vault-tree {
  margin: 0;
  padding: 0;
  list-style: none;
}

.vault-tree--virtual {
  height: min(60vh, 48rem);
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.vault-tree :deep(.vault-tree) {
  padding-left: 0.7rem;
}

.vault-tree-item {
  display: grid;
  gap: 0.2rem;
  padding: 0;
  color: var(--synapse-color-text-muted);
  cursor: pointer;
  overflow: hidden;
}

.vault-tree--virtual > .vault-tree-item {
  height: 3.5rem;
}

.vault-tree-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2.35rem;
  padding: 0.55rem 0.45rem;
  padding-inline-start: calc(0.45rem + min(6rem, var(--tree-depth, 0) * 1rem));
  border-radius: var(--synapse-radius-sm);
  transition:
    background 140ms ease,
    color 140ms ease;
}

.vault-tree-item:hover > .vault-tree-row {
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-muted);
}

.vault-tree-item[aria-selected="true"] > .vault-tree-row {
  color: var(--synapse-color-accent-strong);
  background: var(--synapse-color-surface-accent);
  font-weight: 650;
}

.vault-tree-item[data-attached="true"] {
  box-shadow: inset 3px 0 0 var(--synapse-color-accent);
}

/* Les dossiers sont des conteneurs : pastille pleine teintée, rail d'accent et
   icône de dossier. Les notes restent des feuilles plates et discrètes avec une
   icône de document. La forme et le fond suffisent à distinguer les deux au
   premier regard, y compris en thème clair comme en thème sombre. */
.vault-tree-item[data-kind="folder"] > .vault-tree-row {
  padding-inline-start: calc(
    0.45rem - 3px + min(6rem, var(--tree-depth, 0) * 1rem)
  );
  color: var(--synapse-color-text);
  background: color-mix(
    in srgb,
    var(--synapse-color-accent) 9%,
    var(--synapse-color-surface-muted)
  );
  border: 1px solid var(--synapse-color-border);
  border-inline-start: 3px solid var(--synapse-color-accent);
  font-weight: 700;
  letter-spacing: 0.01em;
}

.vault-tree-item[data-kind="folder"]:hover:not([aria-selected="true"])
  > .vault-tree-row {
  background: color-mix(
    in srgb,
    var(--synapse-color-accent) 16%,
    var(--synapse-color-surface-muted)
  );
}

.vault-tree-item[data-kind="folder"][aria-selected="true"] > .vault-tree-row {
  color: var(--synapse-color-accent-strong);
  background: var(--synapse-color-surface-accent);
  border-color: var(--synapse-color-accent);
}

.vault-tree-item[data-kind="folder"][aria-selected="true"]:hover
  > .vault-tree-row {
  background: color-mix(
    in srgb,
    var(--synapse-color-accent) 22%,
    var(--synapse-color-surface-accent)
  );
}

.vault-tree-kind {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  color: var(--synapse-color-text-muted);
}

.vault-tree-kind svg {
  width: 100%;
  height: 100%;
}

.vault-tree-item[data-kind="folder"] > .vault-tree-row > .vault-tree-kind {
  color: var(--synapse-color-accent);
}

.vault-tree-disclosure {
  flex-shrink: 0;
  color: var(--synapse-color-accent);
  font-size: 0.75rem;
}

.vault-tree-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vault-tree-delete {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  height: 1.85rem;
  margin-inline-start: auto;
  padding: 0;
  border: 1px solid
    color-mix(in srgb, var(--synapse-color-danger) 35%, transparent);
  border-radius: 0.5rem;
  color: var(--synapse-color-danger);
  background: color-mix(
    in srgb,
    var(--synapse-color-danger) 18%,
    var(--synapse-color-surface-raised)
  );
  opacity: 0;
  cursor: pointer;
  transition:
    opacity 140ms ease,
    color 140ms ease,
    background 140ms ease,
    border-color 140ms ease,
    transform 140ms ease;
}

:global(.synapse-dark) .vault-tree-delete {
  color: #fff;
  border-color: color-mix(in srgb, #fff 35%, transparent);
  background: color-mix(in srgb, #fff 16%, var(--synapse-color-surface-muted));
}

.vault-tree-item:hover .vault-tree-delete,
.vault-tree-item:focus-within .vault-tree-delete,
.vault-tree-delete:focus-visible {
  opacity: 1;
}

@media (hover: none) {
  .vault-tree-delete {
    opacity: 1;
  }
}

.vault-tree-delete:hover,
.vault-tree-delete:focus-visible {
  color: #fff;
  background: var(--synapse-color-danger);
  border-color: var(--synapse-color-danger);
  transform: scale(1.06);
}

:global(.synapse-dark) .vault-tree-delete:hover,
:global(.synapse-dark) .vault-tree-delete:focus-visible {
  color: #0f172a;
  background: #fff;
  border-color: #fff;
}

.vault-tree-empty {
  display: grid;
  gap: 0.45rem;
  padding: 1.25rem 0.5rem;
  color: var(--synapse-color-text-muted);
  font-size: 0.85rem;
  line-height: 1.45;
}

.vault-tree-empty strong {
  color: var(--synapse-color-text);
}

.vault-tree-empty-icon {
  color: var(--synapse-color-accent);
  font-size: 1.5rem;
}
</style>
