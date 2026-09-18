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
    class="markdown-preview markdown-body"
    role="region"
    v-html="renderedMarkdown"
  />
</template>

<style scoped>
.markdown-preview {
  overflow: auto;
  color: var(--synapse-color-text);
}

.markdown-body :deep(p) {
  margin: 0 0 0.85em;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  margin: 1em 0 0.4em;
  line-height: 1.25;
}

.markdown-body :deep(h1) {
  font-size: 1.75rem;
  border-bottom: 1px solid var(--synapse-color-border);
  padding-bottom: 0.25em;
}

.markdown-body :deep(h2) {
  font-size: 1.4rem;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.4em;
  margin: 0 0 0.85em;
}

.markdown-body :deep(code) {
  font-family: var(--synapse-font-mono);
  font-size: 0.9em;
  background: var(--synapse-color-surface-muted);
  border-radius: 0.3rem;
  padding: 0.1em 0.35em;
}

.markdown-body :deep(pre) {
  background: var(--synapse-color-surface-muted);
  border-radius: var(--synapse-radius-sm);
  padding: 0.75rem 1rem;
  overflow: auto;
  margin: 0 0 0.85em;
}

.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
}

.markdown-body :deep(blockquote) {
  margin: 0 0 0.85em;
  padding-left: 0.85em;
  border-left: 3px solid var(--synapse-color-accent);
  color: var(--synapse-color-text-muted);
}

.markdown-body :deep(a) {
  color: var(--synapse-color-accent);
}

.markdown-body :deep(br) {
  display: block;
  content: "";
  margin-top: 0.15em;
}
</style>
