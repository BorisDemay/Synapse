<script setup lang="ts">
withDefaults(
  defineProps<{
    compact?: boolean;
    collapsed?: boolean;
  }>(),
  {
    compact: false,
    collapsed: false,
  },
);

defineEmits<{
  "new-note": [];
}>();
</script>

<template>
  <div
    class="vault-notes-section-header"
    :class="{ 'vault-notes-section-header--collapsed': collapsed }"
    :data-compact="compact ? 'true' : undefined"
  >
    <span v-if="!collapsed" class="vault-notes-section-title">Notes</span>
    <button
      class="vault-notes-new-button"
      type="button"
      aria-label="Nouvelle note"
      @click="$emit('new-note')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2h6Z" />
      </svg>
      <span v-if="!collapsed">Nouvelle note</span>
    </button>
  </div>
</template>

<style scoped>
.vault-notes-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  padding-inline: 0.7rem;
}

.vault-notes-section-header[data-compact="true"] {
  padding-inline: 0.45rem;
}

.vault-notes-section-header--collapsed {
  justify-content: center;
  padding-inline: 0;
}

.vault-notes-new-button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 2rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 650;
  cursor: pointer;
  transition:
    color 140ms ease,
    border-color 140ms ease,
    background 140ms ease;
}

.vault-notes-new-button svg {
  width: 0.95rem;
  height: 0.95rem;
}

.vault-notes-new-button:hover,
.vault-notes-new-button:focus-visible {
  color: var(--synapse-color-accent-strong);
  border-color: color-mix(
    in srgb,
    var(--synapse-color-accent) 35%,
    var(--synapse-color-border)
  );
  background: var(--synapse-color-surface-accent);
  outline: none;
}

.vault-notes-section-header--collapsed .vault-notes-new-button {
  width: 2rem;
  padding: 0;
  justify-content: center;
}

.vault-notes-section-title {
  color: var(--synapse-color-text);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
}
</style>
