<script setup lang="ts">
import { computed, ref } from "vue";

export interface HistoryPanelEntry {
  label: string;
  recordedAt?: string;
  revision: number;
  recoverySnapshot?: boolean;
}

export interface HistoryRestorePoint {
  label: string;
  recordedAt: string;
  revision: number;
}

const props = defineProps<{
  entries: HistoryPanelEntry[];
  restorePoints?: HistoryRestorePoint[];
  recoveryView?: boolean;
}>();

const emit = defineEmits<{
  createRestorePoint: [];
  restore: [revision: number];
}>();

const recordedAtFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatRecordedAt(value: string): string {
  const recordedAt = new Date(value);

  return Number.isNaN(recordedAt.getTime())
    ? "Date inconnue"
    : recordedAtFormatter.format(recordedAt);
}

const visibleEntries = computed(() => {
  if (!props.recoveryView) return props.entries;
  const retentionMs = 7 * 24 * 60 * 60_000;
  const now = Date.now();
  return props.entries.filter((entry) => {
    const recordedAt = entry.recordedAt ? Date.parse(entry.recordedAt) : NaN;
    return (
      entry.recoverySnapshot === true &&
      (!Number.isFinite(recordedAt) || now - recordedAt <= retentionMs)
    );
  });
});

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
  <section class="history-panel" aria-labelledby="history-title">
    <h2 id="history-title">
      {{
        props.recoveryView
          ? "Snapshots de récupération locaux"
          : "Historique local"
      }}
    </h2>
    <p v-if="props.recoveryView" class="history-description">
      Instantanés chiffrés espacés d’au moins 5 minutes, conservés 7 jours. Ils
      ne constituent pas un historique à chaque sauvegarde ni une sauvegarde
      indépendante.
    </p>
    <p v-if="visibleEntries.length === 0" class="history-empty" role="status">
      {{
        props.recoveryView
          ? "Aucun snapshot de récupération disponible."
          : "Aucune révision."
      }}
    </p>
    <ul v-else class="history-list">
      <li v-for="entry in visibleEntries" :key="entry.revision">
        <button
          class="history-entry"
          type="button"
          @click="requestRestore(entry)"
        >
          <span class="history-entry-label">{{ entry.label }}</span>
          <time
            v-if="entry.recordedAt"
            class="history-entry-date"
            :datetime="entry.recordedAt"
          >
            {{ formatRecordedAt(entry.recordedAt) }}
          </time>
        </button>
      </li>
    </ul>
    <button
      v-if="!props.recoveryView"
      class="history-create"
      data-action="create-restore-point"
      type="button"
      @click="emit('createRestorePoint')"
    >
      Créer un point de restauration
    </button>
    <section
      v-if="props.restorePoints?.length"
      class="history-restore-points"
      :aria-label="
        props.recoveryView ? 'Points de restauration nommés' : 'Restore points'
      "
    >
      <h3>
        {{
          props.recoveryView
            ? "Points de restauration nommés existants"
            : "Points de restauration"
        }}
      </h3>
      <ul class="history-list">
        <li
          v-for="point in props.restorePoints"
          :key="`${point.revision}-${point.label}`"
        >
          <button
            class="history-entry"
            type="button"
            @click="requestRestore(point)"
          >
            <span class="history-entry-label">{{ point.label }}</span>
            <time class="history-entry-date" :datetime="point.recordedAt">
              {{ formatRecordedAt(point.recordedAt) }}
            </time>
          </button>
        </li>
      </ul>
    </section>
    <div
      v-if="pendingRestore"
      class="history-confirm"
      aria-labelledby="restore-title"
      aria-modal="true"
      role="alertdialog"
    >
      <h3 id="restore-title">Restaurer {{ pendingRestore.label }} ?</h3>
      <div class="history-confirm-actions">
        <button type="button" @click="pendingRestore = undefined">
          Annuler
        </button>
        <button
          class="history-confirm-restore"
          data-action="confirm-restore"
          type="button"
          @click="confirmRestore"
        >
          Restaurer
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.history-panel {
  display: grid;
  gap: 0.85rem;
}

.history-panel h2,
.history-panel h3 {
  margin: 0;
}

.history-panel h2 {
  font-size: 1.05rem;
}

.history-panel h3 {
  font-size: 0.95rem;
}

.history-description {
  margin: 0;
  color: var(--synapse-color-text-muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.history-empty {
  margin: 0;
  padding: 0.7rem 0.85rem;
  border: 1px dashed var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: var(--synapse-color-surface-muted);
  font-size: 0.85rem;
  line-height: 1.45;
}

.history-list {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-entry {
  display: grid;
  gap: 0.2rem;
  width: 100%;
  padding: 0.65rem 0.8rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
  box-shadow: var(--synapse-shadow-sm);
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background 140ms ease;
}

.history-entry:hover,
.history-entry:focus-visible {
  border-color: var(--synapse-color-accent);
  background: var(--synapse-color-surface-muted);
}

.history-entry:focus-visible {
  outline: 2px solid var(--synapse-color-accent);
  outline-offset: 2px;
}

.history-entry-label {
  font-size: 0.92rem;
  font-weight: 650;
}

.history-entry-date {
  color: var(--synapse-color-text-muted);
  font-size: 0.78rem;
}

.history-create {
  justify-self: start;
  min-height: 2.4rem;
  padding: 0.5rem 0.85rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
  box-shadow: var(--synapse-shadow-sm);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

.history-create:hover,
.history-create:focus-visible {
  border-color: var(--synapse-color-accent);
  background: var(--synapse-color-surface-muted);
}

.history-restore-points {
  display: grid;
  gap: 0.6rem;
  margin-block-start: 0.25rem;
  padding-block-start: 0.85rem;
  border-block-start: 1px solid var(--synapse-color-border);
}

.history-confirm {
  display: grid;
  gap: 0.75rem;
  padding: 0.85rem;
  border: 1px solid var(--synapse-color-accent);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
  box-shadow: var(--synapse-shadow-md);
}

.history-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.history-confirm-actions button {
  min-height: 2.4rem;
  padding: 0.5rem 0.85rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

.history-confirm-actions button:hover,
.history-confirm-actions button:focus-visible {
  border-color: var(--synapse-color-accent);
  background: var(--synapse-color-surface-muted);
}

.history-confirm-actions button:focus-visible {
  outline: 2px solid var(--synapse-color-accent);
  outline-offset: 2px;
}

.history-confirm-restore {
  color: var(--synapse-color-accent-contrast);
  background: var(--synapse-color-accent);
  border-color: var(--synapse-color-accent);
}

.history-confirm-restore:hover,
.history-confirm-restore:focus-visible {
  color: var(--synapse-color-accent-contrast);
  background: var(--synapse-color-accent-strong);
  border-color: var(--synapse-color-accent-strong);
}
</style>
