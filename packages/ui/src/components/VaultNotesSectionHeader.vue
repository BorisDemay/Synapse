<script setup lang="ts">
import IconActionButton from "./IconActionButton.vue";

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
    <IconActionButton label="Nouvelle note" @click="$emit('new-note')">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2h6Z" />
      </svg>
    </IconActionButton>
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

.vault-notes-section-title {
  color: var(--synapse-color-text);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
}
</style>
