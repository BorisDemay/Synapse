<script setup lang="ts">
defineProps<{
  label: string;
}>();
</script>

<template>
  <button
    class="icon-action-button"
    type="button"
    :aria-label="label"
    v-synapse-tooltip="label"
  >
    <slot />
  </button>
</template>

<style scoped>
.icon-action-button {
  display: inline-grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: var(--synapse-color-surface-raised);
  cursor: pointer;
  transition:
    color 140ms ease,
    border-color 140ms ease,
    background 140ms ease;
}

.icon-action-button:hover,
.icon-action-button:focus-visible {
  color: var(--synapse-color-text);
  border-color: color-mix(
    in srgb,
    var(--synapse-color-accent) 35%,
    var(--synapse-color-border)
  );
  background: var(--synapse-color-surface-muted);
  outline: none;
}

.icon-action-button :deep(svg) {
  width: 1rem;
  height: 1rem;
}
</style>
