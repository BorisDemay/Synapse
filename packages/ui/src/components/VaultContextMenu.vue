<script setup lang="ts">
import type { MarkdownMenuItem } from "../markdown/editor-tools";
import PointerContextMenu from "./PointerContextMenu.vue";

withDefaults(
  defineProps<{
    items: readonly MarkdownMenuItem[];
    label?: string;
    open: boolean;
    x: number;
    y: number;
  }>(),
  { label: "Actions de la note" },
);

const emit = defineEmits<{
  close: [];
  select: [id: string];
}>();
</script>

<template>
  <!-- Menu contextuel de l'arbre du coffre : emballage de
       PointerContextMenu avec le libellé spécifique aux notes. -->
  <PointerContextMenu
    :items="items"
    :label="label"
    :open="open"
    :x="x"
    :y="y"
    @close="emit('close')"
    @select="emit('select', $event)"
  />
</template>
