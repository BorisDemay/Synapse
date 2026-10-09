<script setup lang="ts">
import { computed } from "vue";

import { useTheme } from "../theme";

const { mode, toggleTheme } = useTheme();
const label = computed(() =>
  mode.value === "dark" ? "Activer le thème clair" : "Activer le thème sombre",
);
</script>

<template>
  <button
    class="theme-toggle"
    type="button"
    :aria-label="label"
    :aria-pressed="mode === 'dark'"
    v-synapse-tooltip="label"
    @click="toggleTheme"
  >
    <span aria-hidden="true">{{ mode === "dark" ? "☼" : "◐" }}</span>
    <span class="theme-toggle-label">
      {{ mode === "dark" ? "Clair" : "Sombre" }}
    </span>
  </button>
</template>
