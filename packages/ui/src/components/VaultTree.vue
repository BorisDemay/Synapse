<script setup lang="ts">
import { nextTick, ref } from "vue";

export interface VaultTreeNode {
  children?: VaultTreeNode[];
  id: string;
  kind?: "attachment" | "folder" | "note";
  label: string;
  path?: string;
  syncStatus?: "conflict" | "error" | "offline" | "pending" | "synced";
  tags?: string[];
}

const props = defineProps<{
  attachedIds?: string[];
  nested?: boolean;
  nodes: VaultTreeNode[];
}>();

const emit = defineEmits<{
  attach: [id: string];
  delete: [id: string];
  select: [id: string];
}>();

const activeIndex = ref(0);
const treeItems = ref<HTMLElement[]>([]);

const collapsed = ref(new Set<string>());

function isFolder(node: VaultTreeNode | undefined) {
  return node?.kind === "folder";
}

function isExpanded(id: string) {
  return !collapsed.value.has(id);
}

function toggleFolder(id: string) {
  const next = new Set(collapsed.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  collapsed.value = next;
}

async function select(index: number) {
  const node = props.nodes[index];

  if (!node) {
    return;
  }
  if (isFolder(node)) {
    toggleFolder(node.id);
    return;
  }
  activeIndex.value = index;
  emit("select", node.id);
  await nextTick();
  treeItems.value[index]?.focus();
}

function attach(index: number) {
  const node = props.nodes[index];
  if (node) {
    emit("attach", node.id);
  }
}

function remove(index: number) {
  const node = props.nodes[index];
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
  if (event.ctrlKey || event.metaKey) {
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
    :aria-label="nested ? undefined : 'Notes du coffre'"
    class="vault-tree"
    role="tree"
  >
    <li
      v-for="(node, index) in nodes"
      :key="node.id"
      class="vault-tree-item"
      ref="treeItems"
      :aria-selected="index === activeIndex"
      :data-attached="
        (attachedIds ?? []).includes(node.id) ? 'true' : undefined
      "
      :data-kind="node.kind"
      :data-status="node.syncStatus"
      role="treeitem"
      :tabindex="index === activeIndex ? 0 : -1"
      @click="onItemClick($event, index)"
      @keydown.delete.prevent="remove(index)"
      @keydown.down.prevent="selectNext(index)"
      @keydown.enter.ctrl.prevent="attach(index)"
      @keydown.enter.meta.prevent="attach(index)"
    >
      <div class="vault-tree-row">
        <span
          class="vault-tree-sync"
          :data-status="node.syncStatus || 'synced'"
          aria-hidden="true"
        />
        <span class="vault-tree-icon" aria-hidden="true">{{
          node.kind === "folder" ? "▸" : node.kind === "attachment" ? "▣" : "▱"
        }}</span>
        <span class="vault-tree-label">{{ node.label }}</span>
        <button
          v-if="node.kind !== 'folder'"
          class="vault-tree-delete"
          type="button"
          tabindex="-1"
          :aria-label="`Supprimer ${node.label}`"
          @click="onDeleteClick($event, index)"
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
      <VaultTree
        v-if="node.children?.length && isExpanded(node.id)"
        nested
        :attached-ids="attachedIds"
        :nodes="node.children"
        @attach="emit('attach', $event)"
        @delete="emit('delete', $event)"
        @select="emit('select', $event)"
      />
    </li>
  </ul>
</template>

<style scoped>
.vault-tree {
  margin: 0;
  padding: 0;
  list-style: none;
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

.vault-tree-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2.35rem;
  padding: 0.55rem 0.45rem;
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

.vault-tree-sync {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: var(--synapse-color-success);
}
.vault-tree-sync[data-status="pending"] {
  background: var(--synapse-color-warning);
}
.vault-tree-sync[data-status="conflict"],
.vault-tree-sync[data-status="error"] {
  background: var(--synapse-color-danger);
}
.vault-tree-sync[data-status="offline"] {
  background: var(--synapse-color-text-muted);
}

.vault-tree-item[data-attached="true"] {
  box-shadow: inset 3px 0 0 var(--synapse-color-accent);
}

.vault-tree-icon {
  color: var(--synapse-color-accent);
  font-size: 1.1rem;
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
