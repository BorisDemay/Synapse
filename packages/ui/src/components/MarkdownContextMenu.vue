<script setup lang="ts">
import type { MarkdownMenuItem } from "../markdown/editor-tools";
import PointerContextMenu from "./PointerContextMenu.vue";

defineProps<{
  items: readonly MarkdownMenuItem[];
  open: boolean;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  close: [];
  select: [id: string];
}>();
</script>

<template>
  <!-- Simple emballage de l'orchestrateur générique : le libellé du menu de
       l'éditeur est figé pour préserver son identité accessible. -->
  <PointerContextMenu
    :items="items"
    label="Outils Markdown"
    :open="open"
    :x="x"
    :y="y"
    @close="emit('close')"
    @select="emit('select', $event)"
  />
</template>
