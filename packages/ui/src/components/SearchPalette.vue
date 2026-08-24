<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

export interface SearchResult {
  hint?: string;
  id: string;
  label: string;
}

export interface PaletteCommand {
  hint?: string;
  id: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    commands?: PaletteCommand[];
    query: string;
    results: SearchResult[];
  }>(),
  {
    commands: () => [],
  },
);

const emit = defineEmits<{
  close: [];
  run: [id: string];
  select: [id: string];
  "update:query": [value: string];
}>();

const isOpen = ref(false);
const activeIndex = ref(0);
const input = ref<HTMLInputElement>();

const visibleCommands = computed(() => {
  const needle = props.query.trim().toLowerCase();
  if (!needle) {
    return props.commands;
  }
  return props.commands.filter((command) =>
    `${command.label} ${command.hint ?? ""}`.toLowerCase().includes(needle),
  );
});

const items = computed(() => [
  ...visibleCommands.value.map((command) => ({
    kind: "command" as const,
    id: command.id,
    label: command.label,
    hint: command.hint,
  })),
  ...props.results.map((result) => ({
    kind: "note" as const,
    id: result.id,
    label: result.label,
    hint: result.hint,
  })),
]);

watch(items, () => {
  activeIndex.value = 0;
});

async function openPalette(query = "") {
  isOpen.value = true;
  emit("update:query", query);
  await nextTick();
  input.value?.focus();
}

function closePalette() {
  isOpen.value = false;
  emit("update:query", "");
  emit("close");
}

function openWithShortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    void openPalette();
  }
  if (event.key === "Escape" && isOpen.value) {
    event.preventDefault();
    closePalette();
  }
}

function activate(index: number) {
  const item = items.value[index];
  if (!item) {
    return;
  }
  if (item.kind === "command") {
    emit("run", item.id);
  } else {
    emit("select", item.id);
  }
  closePalette();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeIndex.value = Math.min(activeIndex.value + 1, items.value.length - 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (event.key === "Enter") {
    event.preventDefault();
    activate(activeIndex.value);
  }
}

onMounted(() => window.addEventListener("keydown", openWithShortcut));
onBeforeUnmount(() => window.removeEventListener("keydown", openWithShortcut));

defineExpose({ openPalette, closePalette, isOpen });
</script>

<template>
  <div
    v-if="isOpen"
    class="search-palette-backdrop"
    role="presentation"
    @click.self="closePalette"
  >
    <section
      aria-label="Recherche dans le coffre"
      class="search-palette"
      role="dialog"
      aria-modal="true"
    >
      <h2 class="search-palette-title">Recherche</h2>
      <input
        ref="input"
        :value="props.query"
        aria-label="Rechercher une note ou une commande"
        class="search-palette-input"
        type="search"
        placeholder="Notes, commandes, tags…"
        @input="emit('update:query', ($event.target as HTMLInputElement).value)"
        @keydown="onKeydown"
      />
      <ul
        v-if="items.length"
        aria-label="Résultats de recherche"
        class="search-palette-list"
        role="listbox"
      >
        <li v-for="(item, index) in items" :key="`${item.kind}-${item.id}`">
          <button
            :aria-selected="index === activeIndex"
            class="search-palette-option"
            role="option"
            type="button"
            @click="activate(index)"
          >
            <span>{{ item.label }}</span>
            <small v-if="item.hint">{{ item.hint }}</small>
          </button>
        </li>
      </ul>
      <p v-else class="search-palette-empty" role="status">Aucun résultat.</p>
    </section>
  </div>
</template>

<style scoped>
.search-palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: start center;
  padding-top: 12vh;
  background: rgb(15 23 42 / 35%);
}

.search-palette {
  width: min(36rem, calc(100vw - 2rem));
  padding: 1rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-md);
  background: var(--synapse-color-surface-raised);
  box-shadow: var(--synapse-shadow-md);
}

.search-palette-title {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
}

.search-palette-input {
  width: 100%;
  margin-bottom: 0.75rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  background: var(--synapse-color-surface);
  color: var(--synapse-color-text);
}

.search-palette-list {
  margin: 0;
  padding: 0;
  max-height: 18rem;
  overflow: auto;
  list-style: none;
}

.search-palette-option {
  display: flex;
  width: 100%;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0.65rem;
  border: 0;
  border-radius: var(--synapse-radius-sm);
  background: transparent;
  color: var(--synapse-color-text);
  text-align: left;
  cursor: pointer;
}

.search-palette-option[aria-selected="true"],
.search-palette-option:hover {
  background: var(--synapse-color-surface-accent);
}

.search-palette-option small {
  color: var(--synapse-color-text-muted);
}

.search-palette-empty {
  margin: 0;
  color: var(--synapse-color-text-muted);
}
</style>
