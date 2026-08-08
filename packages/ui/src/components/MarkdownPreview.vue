<script setup lang="ts">
import { computed } from "vue";

import { renderMarkdown } from "../markdown/render";

const props = defineProps<{
  source: string;
}>();

const renderedMarkdown = computed(() => renderMarkdown(props.source));
</script>

<template>
  <section
    aria-label="Aperçu Markdown"
    class="markdown-preview"
    role="region"
    v-html="renderedMarkdown"
  />
</template>
