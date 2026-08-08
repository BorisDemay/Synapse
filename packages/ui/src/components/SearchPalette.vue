<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

export interface SearchResult {
  id: string;
  label: string;
}

const props = defineProps<{
  results: SearchResult[];
}>();

const emit = defineEmits<{
  select: [id: string];
}>();

const isOpen = ref(false);

function openWithShortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    isOpen.value = true;
  }
}

function select(result: SearchResult) {
  emit("select", result.id);
  isOpen.value = false;
}

onMounted(() => window.addEventListener("keydown", openWithShortcut));
onBeforeUnmount(() => window.removeEventListener("keydown", openWithShortcut));
</script>

<template>
  <section v-if="isOpen" aria-label="Recherche dans le coffre" role="dialog">
    <h2>Recherche</h2>
    <ul aria-label="Résultats de recherche" role="listbox">
      <li v-for="result in props.results" :key="result.id">
        <button role="option" type="button" @click="select(result)">
          {{ result.label }}
        </button>
      </li>
    </ul>
  </section>
</template>
