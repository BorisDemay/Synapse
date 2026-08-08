<script setup lang="ts">
import { nextTick, ref } from "vue";

export interface VaultTreeNode {
  id: string;
  label: string;
}

const props = defineProps<{
  nodes: VaultTreeNode[];
}>();

const emit = defineEmits<{
  select: [id: string];
}>();

const activeIndex = ref(0);
const treeItems = ref<HTMLElement[]>([]);

async function select(index: number) {
  const node = props.nodes[index];

  if (node) {
    activeIndex.value = index;
    emit("select", node.id);
    await nextTick();
    treeItems.value[index]?.focus();
  }
}

async function selectNext(index: number) {
  await select(index + 1);
}
</script>

<template>
  <p v-if="nodes.length === 0" role="status">Aucune note dans ce coffre.</p>
  <ul v-else aria-label="Notes du coffre" role="tree">
    <li
      v-for="(node, index) in nodes"
      :key="node.id"
      ref="treeItems"
      :aria-selected="index === activeIndex"
      role="treeitem"
      :tabindex="index === activeIndex ? 0 : -1"
      @click="select(index)"
      @keydown.down.prevent="selectNext(index)"
    >
      {{ node.label }}
    </li>
  </ul>
</template>
