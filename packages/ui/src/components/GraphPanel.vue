<script setup lang="ts">
import type { LocalGraph } from "../vault/query";

const props = defineProps<{
  graph: LocalGraph;
  selectedId?: string;
}>();

const emit = defineEmits<{
  close: [];
  select: [id: string];
}>();

function degree(id: string): number {
  return props.graph.edges.filter(
    (edge) => edge.source === id || edge.target === id,
  ).length;
}
</script>

<template>
  <section aria-labelledby="graph-title" class="graph-panel">
    <header>
      <div>
        <h2 id="graph-title">Graphe local</h2>
        <p>
          {{ props.graph.nodes.length }} notes ·
          {{ props.graph.edges.length }} liens
        </p>
      </div>
      <button
        aria-label="Fermer le graphe"
        type="button"
        @click="emit('close')"
      >
        ×
      </button>
    </header>
    <p class="graph-privacy" role="status">
      Calculé uniquement dans ce coffre déverrouillé.
    </p>
    <ul aria-label="Notes du graphe">
      <li v-for="node in props.graph.nodes" :key="node.id">
        <button
          :aria-current="node.id === props.selectedId ? 'page' : undefined"
          type="button"
          @click="emit('select', node.id)"
        >
          <span>{{ node.label }}</span
          ><small>{{ degree(node.id) }} liens</small>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.graph-panel {
  display: grid;
  gap: 0.85rem;
}
.graph-panel header,
.graph-panel li button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.graph-panel h2,
.graph-panel p {
  margin: 0;
}
.graph-panel p,
.graph-panel small {
  color: var(--synapse-color-text-muted);
}
.graph-panel header > button,
.graph-panel li button {
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  background: var(--synapse-color-surface-raised);
  color: var(--synapse-color-text);
  cursor: pointer;
}
.graph-panel header > button {
  width: 2rem;
  height: 2rem;
  font-size: 1.15rem;
}
.graph-panel ul {
  display: grid;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 24rem;
  overflow: auto;
}
.graph-panel li button {
  width: 100%;
  padding: 0.55rem 0.65rem;
  text-align: left;
}
.graph-panel li button[aria-current="page"] {
  border-color: var(--synapse-color-accent);
}
.graph-privacy {
  font-size: 0.85rem;
}
</style>
