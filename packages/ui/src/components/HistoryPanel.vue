<script setup lang="ts">
import { ref } from "vue";

export interface HistoryPanelEntry {
  label: string;
  recordedAt?: string;
  revision: number;
}

export interface HistoryRestorePoint {
  label: string;
  recordedAt: string;
  revision: number;
}

const props = defineProps<{
  entries: HistoryPanelEntry[];
  restorePoints?: HistoryRestorePoint[];
}>();

const emit = defineEmits<{
  restore: [revision: number];
  createRestorePoint: [];
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
    <button
      data-action="create-restore-point"
      type="button"
      @click="emit('createRestorePoint')"
    >
      Créer un restore point
    </button>
    <section v-if="props.restorePoints?.length" aria-label="Restore points">
      <h3>Restore points</h3>
      <ul>
        <li
          v-for="point in props.restorePoints"
          :key="`${point.revision}-${point.label}`"
        >
          <button type="button" @click="requestRestore(point)">
            {{ point.label }} <small>{{ point.recordedAt }}</small>
          </button>
        </li>
      </ul>
    </section>
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
