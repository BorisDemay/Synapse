<script setup lang="ts">
export interface Backlink {
  id: string;
  label: string;
}

defineProps<{
  backlinks: Backlink[];
}>();

const emit = defineEmits<{
  select: [id: string];
}>();
</script>

<template>
  <section aria-labelledby="backlinks-title">
    <h2 id="backlinks-title">Liens entrants</h2>
    <p v-if="backlinks.length === 0" role="status">Aucun lien entrant.</p>
    <ul v-else>
      <li v-for="backlink in backlinks" :key="backlink.id">
        <button type="button" @click="emit('select', backlink.id)">
          {{ backlink.label }}
        </button>
      </li>
    </ul>
  </section>
</template>
