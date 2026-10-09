<script setup lang="ts">
import { computed, ref } from "vue";

import type { UpdateCoordinator } from "../update/coordinator";

const props = defineProps<{ coordinator: UpdateCoordinator }>();

const showNotes = ref(false);
const dismissed = ref(false);

const state = computed(() => props.coordinator.snapshot.value.state);
const snapshot = computed(() => props.coordinator.snapshot.value);
const percent = computed(() =>
  Math.round((snapshot.value.progress ?? 0) * 100),
);
const visible = computed(() => {
  if (state.value === "ready") return !dismissed.value;
  if (state.value === "downloading" || state.value === "applying") return true;
  // A failed check (e.g. offline) stays silent; only a known update that could
  // not be applied surfaces an error.
  return state.value === "error" && snapshot.value.metadata !== null;
});

function applyUpdate() {
  void props.coordinator.apply();
}

function retry() {
  dismissed.value = false;
  void props.coordinator.check();
}
</script>

<template>
  <aside
    v-if="visible"
    class="synapse-update-toast"
    :data-kind="state === 'error' ? 'error' : 'info'"
    :role="state === 'error' ? 'alert' : 'status'"
    :aria-live="state === 'error' ? 'assertive' : 'polite'"
  >
    <template v-if="state === 'ready'">
      <strong>Une mise à jour est disponible</strong>
      <span class="synapse-update-toast__version">
        Version {{ snapshot.metadata?.version }}
      </span>
      <p
        v-if="showNotes && snapshot.metadata?.releaseNotes"
        class="synapse-update-toast__notes"
      >
        {{ snapshot.metadata.releaseNotes }}
      </p>
      <div class="synapse-update-toast__actions">
        <button
          type="button"
          class="synapse-update-toast__secondary"
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

    <template v-else-if="state === 'downloading' || state === 'applying'">
      <strong>
        {{
          state === "applying"
            ? "Mise à jour en cours"
            : "Téléchargement de la mise à jour"
        }}
      </strong>
      <span class="synapse-update-toast__status">{{ snapshot.status }}</span>
      <progress
        v-if="state === 'downloading'"
        :value="snapshot.progress ?? 0"
        max="1"
        aria-label="Progression du téléchargement"
      />
      <progress v-else aria-label="Progression de la mise à jour" />
      <span
        v-if="state === 'downloading'"
        class="synapse-update-toast__version"
      >
        {{ percent }} %
      </span>
    </template>

    <template v-else>
      <strong>Échec de la mise à jour</strong>
      <span class="synapse-update-toast__status">{{ snapshot.error }}</span>
      <div class="synapse-update-toast__actions">
        <button
          type="button"
          class="synapse-update-toast__secondary"
          @click="dismissed = true"
        >
          Fermer
        </button>
        <button type="button" @click="retry">Réessayer</button>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.synapse-update-toast {
  --toast-accent: #60a5fa;
  background: var(--synapse-color-surface-raised, #172033);
  border: 1px solid var(--toast-accent);
  border-inline-start: 0.3rem solid var(--toast-accent);
  border-radius: 0.6rem;
  box-shadow: 0 12px 30px rgb(0 0 0 / 35%);
  color: var(--synapse-color-text, #f8fafc);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-inline-size: 100%;
  padding: 0.85rem 1rem;
  pointer-events: auto;
}

.synapse-update-toast[data-kind="error"] {
  --toast-accent: #fb7185;
}

.synapse-update-toast__version {
  color: var(--synapse-color-text-muted, #94a3b8);
  font-size: 0.85rem;
}

.synapse-update-toast__status {
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

.synapse-update-toast button:not(.synapse-update-toast__secondary) {
  background: var(--synapse-color-accent, #60a5fa);
  color: #07101f;
}

.synapse-update-toast__secondary {
  background: transparent;
  color: var(--synapse-color-text, #f8fafc);
  font-weight: 500;
  text-decoration: underline;
}

.synapse-update-toast progress {
  inline-size: 100%;
}

.synapse-update-toast progress:not([value]) {
  animation: synapse-update-pulse 1.2s ease-in-out infinite;
}

@keyframes synapse-update-pulse {
  0%,
  100% {
    opacity: 0.5;
  }

  50% {
    opacity: 1;
  }
}
</style>
