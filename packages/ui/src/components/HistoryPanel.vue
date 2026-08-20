<script setup lang="ts">
import { ref } from "vue";

export interface HistoryPanelEntry {
  label: string;
  recordedAt?: string;
  revision: number;
}

const props = defineProps<{
  entries: HistoryPanelEntry[];
}>();

const emit = defineEmits<{
  restore: [revision: number];
}>();

const pendingRestore = ref<HistoryPanelEntry>();

function requestRestore(entry: HistoryPanelEntry) {
  pendingRestore.value = entry;
}

function confirmRestore() {
  if (!pendingRestore.value) {
    return;
  }

  emit("restore", pendingRestore.value.revision);
  pendingRestore.value = undefined;
}
</script>

<template>
  <section aria-labelledby="history-title">
    <h2 id="history-title">Historique local</h2>
    <p v-if="props.entries.length === 0" role="status">Aucune révision.</p>
    <ul v-else>
      <li v-for="entry in props.entries" :key="entry.revision">
        <button type="button" @click="requestRestore(entry)">
          {{ entry.label }}
          <small v-if="entry.recordedAt">{{ entry.recordedAt }}</small>
        </button>
      </li>
    </ul>
    <div
      v-if="pendingRestore"
      aria-labelledby="restore-title"
      aria-modal="true"
      role="alertdialog"
    >
      <h3 id="restore-title">Restaurer {{ pendingRestore.label }} ?</h3>
      <button type="button" @click="pendingRestore = undefined">Annuler</button>
      <button
        data-action="confirm-restore"
        type="button"
        @click="confirmRestore"
      >
        Restaurer
      </button>
    </div>
  </section>
</template>
