<script setup lang="ts">
import { ref } from "vue";

import type { UpdateCoordinator } from "../update/coordinator";

const props = defineProps<{ coordinator: UpdateCoordinator }>();

const showNotes = ref(false);

function applyUpdate() {
  void props.coordinator.apply();
}
</script>

<template>
  <aside
    v-if="
      coordinator.snapshot.value.state === 'ready' ||
      coordinator.snapshot.value.state === 'downloading'
    "
    class="synapse-update-toast"
    role="status"
    aria-live="polite"
  >
    <template v-if="coordinator.snapshot.value.state === 'ready'">
      <strong>Une mise à jour est disponible</strong>
      <span class="synapse-update-toast__version">
        Version {{ coordinator.snapshot.value.metadata?.version }}
      </span>
      <p
        v-if="showNotes && coordinator.snapshot.value.metadata?.releaseNotes"
        class="synapse-update-toast__notes"
      >
        {{ coordinator.snapshot.value.metadata.releaseNotes }}
      </p>
      <div class="synapse-update-toast__actions">
        <button
          type="button"
          class="synapse-update-toast__notes-toggle"
          :aria-expanded="showNotes"
          @click="showNotes = !showNotes"
        >
          Lire la note de mise à jour
        </button>
        <button type="button" @click="applyUpdate">
          {{ coordinator.activationLabel }}
        </button>
      </div>
    </template>
    <template v-else>
      <strong>Téléchargement de la mise à jour</strong>
      <progress
        :value="coordinator.snapshot.value.progress ?? 0"
        max="1"
        aria-label="Progression du téléchargement"
      />
    </template>
  </aside>
</template>

<style scoped>
.synapse-update-toast {
  background: var(--synapse-color-surface-raised, #172033);
  border: 1px solid var(--synapse-color-border, #334155);
  border-radius: 0.6rem;
  box-shadow: 0 12px 30px rgb(0 0 0 / 35%);
  color: var(--synapse-color-text, #f8fafc);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  inset-block-end: 1rem;
  inset-inline-end: 1rem;
  max-inline-size: min(24rem, calc(100vw - 2rem));
  padding: 0.85rem 1rem;
  position: fixed;
  z-index: 1000;
}

.synapse-update-toast__version {
  color: var(--synapse-color-text-muted, #94a3b8);
  font-size: 0.85rem;
}

.synapse-update-toast__notes {
  background: rgb(15 23 42 / 60%);
  border-radius: 0.4rem;
  font-size: 0.85rem;
  margin: 0.25rem 0;
  max-block-size: 10rem;
  overflow: auto;
  padding: 0.5rem 0.65rem;
  white-space: pre-wrap;
}

.synapse-update-toast__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-block-start: 0.25rem;
}

.synapse-update-toast button {
  border: 0;
  border-radius: 0.35rem;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  padding: 0.4rem 0.75rem;
}

.synapse-update-toast button:not(.synapse-update-toast__notes-toggle) {
  background: var(--synapse-color-accent, #60a5fa);
  color: #07101f;
}

.synapse-update-toast__notes-toggle {
  background: transparent;
  color: var(--synapse-color-text, #f8fafc);
  font-weight: 500;
  text-decoration: underline;
}

.synapse-update-toast progress {
  inline-size: 100%;
}
</style>
