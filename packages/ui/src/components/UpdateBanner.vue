<script setup lang="ts">
import type { UpdateCoordinator } from "../update/coordinator";

const props = defineProps<{ coordinator: UpdateCoordinator }>();

function applyUpdate() {
  void props.coordinator.apply();
}
</script>

<template>
  <aside
    v-if="coordinator.snapshot.value.state === 'ready'"
    class="synapse-update-banner"
    role="status"
    aria-live="polite"
  >
    <div>
      <strong>Mise à jour prête</strong>
      <span>Version {{ coordinator.snapshot.value.metadata?.version }}</span>
    </div>
    <button type="button" @click="applyUpdate">
      {{ coordinator.activationLabel }}
    </button>
  </aside>
  <aside
    v-else-if="coordinator.snapshot.value.state === 'downloading'"
    class="synapse-update-banner"
    role="status"
    aria-live="polite"
  >
    <span>Téléchargement de la mise à jour</span>
    <progress
      :value="coordinator.snapshot.value.progress ?? 0"
      max="1"
      aria-label="Progression du téléchargement"
    />
  </aside>
</template>

<style scoped>
.synapse-update-banner {
  align-items: center;
  background: var(--synapse-surface-raised, #172033);
  border-block-end: 1px solid var(--synapse-border, #334155);
  color: var(--synapse-text, #f8fafc);
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  position: relative;
  z-index: 100;
}

.synapse-update-banner div {
  align-items: baseline;
  display: flex;
  gap: 0.65rem;
}

.synapse-update-banner button {
  background: var(--synapse-accent, #60a5fa);
  border: 0;
  border-radius: 0.35rem;
  color: #07101f;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  padding: 0.4rem 0.75rem;
}

.synapse-update-banner progress {
  inline-size: min(18rem, 45vw);
}
</style>
