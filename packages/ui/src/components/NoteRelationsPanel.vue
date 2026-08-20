<script setup lang="ts">
import { ref } from "vue";

import BacklinksPanel, { type Backlink } from "./BacklinksPanel.vue";
import HistoryPanel, { type HistoryPanelEntry } from "./HistoryPanel.vue";

defineProps<{
  backlinks: Backlink[];
  history: HistoryPanelEntry[];
}>();

const emit = defineEmits<{
  close: [];
  select: [id: string];
  restore: [revision: number];
}>();

const activeTab = ref<"backlinks" | "history">("backlinks");
</script>

<template>
  <div class="note-relations">
    <header class="note-relations-header">
      <span>Note active</span>
      <button
        aria-label="Fermer le panneau Historique"
        name="close-note-relations"
        type="button"
        @click="emit('close')"
      >
        ×
      </button>
    </header>
    <div
      class="note-relations-tabs"
      role="tablist"
      aria-label="Relations de la note"
    >
      <button
        id="relations-backlinks-tab"
        :aria-selected="activeTab === 'backlinks'"
        aria-controls="relations-backlinks"
        role="tab"
        type="button"
        @click="activeTab = 'backlinks'"
      >
        Liens entrants
      </button>
      <button
        id="relations-history-tab"
        :aria-selected="activeTab === 'history'"
        aria-controls="relations-history"
        role="tab"
        type="button"
        @click="activeTab = 'history'"
      >
        Historique local
      </button>
    </div>

    <div
      v-if="activeTab === 'backlinks'"
      id="relations-backlinks"
      aria-labelledby="relations-backlinks-tab"
      role="tabpanel"
      tabindex="0"
    >
      <BacklinksPanel :backlinks="backlinks" @select="emit('select', $event)" />
    </div>
    <div
      v-else
      id="relations-history"
      aria-labelledby="relations-history-tab"
      role="tabpanel"
      tabindex="0"
    >
      <HistoryPanel :entries="history" @restore="emit('restore', $event)" />
    </div>
  </div>
</template>

<style scoped>
.note-relations {
  display: grid;
  gap: 0.85rem;
}

.note-relations-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  color: var(--synapse-color-text-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.note-relations-header button {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: var(--synapse-color-surface-raised);
  font: inherit;
  font-size: 1.15rem;
  line-height: 1;
  cursor: pointer;
}

.note-relations-header button:hover {
  border-color: var(--synapse-color-accent);
  color: var(--synapse-color-text);
}

.note-relations-header button:focus-visible {
  outline: 2px solid var(--synapse-color-accent);
  outline-offset: 1px;
}

.note-relations-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem;
  padding: 0.25rem;
  border-radius: var(--synapse-radius-md);
  background: var(--synapse-color-surface-muted);
}

.note-relations-tabs button {
  min-width: 0;
  padding: 0.5rem 0.4rem;
  border: 0;
  border-radius: var(--synapse-radius-sm);
  background: transparent;
  color: var(--synapse-color-text-muted);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 650;
  cursor: pointer;
}

.note-relations-tabs button[aria-selected="true"] {
  background: var(--synapse-color-surface-raised);
  color: var(--synapse-color-text);
  box-shadow: var(--synapse-shadow-sm);
}

.note-relations-tabs button:focus-visible {
  outline: 2px solid var(--synapse-color-accent);
  outline-offset: 1px;
}
</style>
