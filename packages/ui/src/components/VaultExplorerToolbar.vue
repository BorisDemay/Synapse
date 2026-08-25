<script setup lang="ts">
import { computed } from "vue";

import IconActionButton from "./IconActionButton.vue";

const props = withDefaults(
  defineProps<{
    showImport?: boolean;
    showImportFolder?: boolean;
    showTemplate?: boolean;
    sidebarCollapsed?: boolean;
    compact?: boolean;
  }>(),
  {
    showImport: false,
    showImportFolder: false,
    showTemplate: false,
    sidebarCollapsed: false,
    compact: false,
  },
);

const emit = defineEmits<{
  import: [];
  "import-folder": [];
  "from-template": [];
  "toggle-compact": [];
  "toggle-sidebar": [];
}>();

const sidebarToggleLabel = computed(() =>
  props.sidebarCollapsed
    ? "Afficher la barre latérale"
    : "Masquer la barre latérale",
);

const compactToggleLabel = computed(() =>
  props.compact
    ? "Afficher les titres de section"
    : "Masquer les titres de section",
);
</script>

<template>
  <div
    class="vault-explorer-toolbar"
    :class="{ 'vault-explorer-toolbar--collapsed': sidebarCollapsed }"
    role="toolbar"
    aria-label="Actions du coffre"
  >
    <IconActionButton
      v-if="showTemplate"
      label="Créer depuis un modèle"
      @click="emit('from-template')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 2.5L18.5 9H14V4.5ZM8 13h8v2H8v-2Zm0 4h5v2H8v-2Z"
        />
      </svg>
    </IconActionButton>
    <IconActionButton v-if="showImport" label="importer une note" @click="emit('import')">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M11 15h2V6.8l2.6 2.6L17 8l-5-5-5 5 1.4 1.4L11 6.8V15Zm-7 4h14v2H4v-2Z"
        />
      </svg>
    </IconActionButton>
    <IconActionButton
      v-if="showImportFolder"
      label="importer une vault"
      @click="emit('import-folder')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z"
        />
      </svg>
    </IconActionButton>
    <span class="vault-explorer-toolbar-spacer" aria-hidden="true" />
    <IconActionButton
      :label="compactToggleLabel"
      @click="emit('toggle-compact')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4 6h16v2H4V6Zm0 5h10v2H4v-2Zm0 5h16v2H4v-2Z"
        />
      </svg>
    </IconActionButton>
    <IconActionButton
      :label="sidebarToggleLabel"
      @click="emit('toggle-sidebar')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M3 5h8v14H3V5Zm10 0h8v14h-8V5ZM5 7v10h4V7H5Zm10 0v10h4V7h-4Z"
        />
      </svg>
    </IconActionButton>
  </div>
</template>

<style scoped>
.vault-explorer-toolbar {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.vault-explorer-toolbar-spacer {
  flex: 1 1 auto;
  min-width: 0.25rem;
}

.vault-explorer-toolbar--collapsed {
  flex-direction: column;
  align-items: center;
  flex-wrap: nowrap;
  width: 100%;
  gap: 0.35rem;
}

.vault-explorer-toolbar--collapsed .vault-explorer-toolbar-spacer {
  display: none;
}
</style>
