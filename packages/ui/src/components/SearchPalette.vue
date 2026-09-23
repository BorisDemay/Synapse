<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import { DialogFocusController, isDialogElementVisible } from "../dialog-focus";
import { pushOverlay, type OverlayHandle } from "../overlay-stack";

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
const dialogElement = ref<HTMLElement>();
const overlay = ref<OverlayHandle>();

function closePalette() {
  if (!isOpen.value) {
    return;
  }
  isOpen.value = false;
  overlay.value?.release();
  overlay.value = undefined;
  dialogFocus.detach();
  emit("update:query", "");
  emit("close");
}

// Échap appartient à la pile d'overlays : elle ne l'envoie qu'à l'overlay du
// dessus, et consomme l'événement avant qu'il n'atteigne ce conteneur.
const dialogFocus = new DialogFocusController({
  getContainer: () => dialogElement.value ?? null,
});

function openOverlay() {
  overlay.value = pushOverlay({
    label: "search-palette",
    lockScroll: true,
    onEscape: closePalette,
  });
}

/**
 * Un autre dialogue modal (paramètres, aperçu, historique) est ouvert : la
 * recherche ne doit pas s'ouvrir au-dessus de lui.
 */
function isAnotherModalOpen(): boolean {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"], dialog[open]',
    ),
  ).some(
    (element) =>
      element !== dialogElement.value && isDialogElementVisible(element),
  );
}

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
  if (isAnotherModalOpen()) return;
  if (isOpen.value) {
    emit("update:query", query);
    input.value?.focus();
    return;
  }
  isOpen.value = true;
  openOverlay();
  emit("update:query", query);
  await nextTick();
  dialogFocus.attach();
  input.value?.focus();
}

/**
 * Ctrl+K bascule la palette : ouvrir ne réinitialise pas la requête en cours,
 * refermer préserve le contrat existant (requête vidée + événement close).
 */
async function togglePaletteFromShortcut() {
  if (isOpen.value) {
    closePalette();
    return;
  }
  if (isAnotherModalOpen()) {
    return;
  }
  isOpen.value = true;
  openOverlay();
  await nextTick();
  dialogFocus.attach();
  input.value?.focus();
}

function openWithShortcut(event: KeyboardEvent) {
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "k"
  ) {
    event.preventDefault();
    event.stopPropagation();
    void togglePaletteFromShortcut();
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

onMounted(() => window.addEventListener("keydown", openWithShortcut, true));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", openWithShortcut, true);
  overlay.value?.release();
  overlay.value = undefined;
  dialogFocus.detach();
});

defineExpose({ openPalette, closePalette, isOpen });
</script>

<template>
  <div
    v-if="isOpen"
    class="search-palette-backdrop"
    role="presentation"
    :style="{ zIndex: overlay?.zIndex }"
    @click.self="closePalette"
  >
    <section
      ref="dialogElement"
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
        <li
          v-if="visibleCommands.length"
          aria-hidden="true"
          class="search-palette-group"
          role="presentation"
        >
          Commandes
        </li>
        <li v-for="command in visibleCommands" :key="`command-${command.id}`">
          <button
            :aria-selected="
              items[activeIndex]?.kind === 'command' &&
              items[activeIndex]?.id === command.id
            "
            class="search-palette-option"
            role="option"
            type="button"
            @click="activate(visibleCommands.indexOf(command))"
          >
            <span>{{ command.label }}</span>
            <small v-if="command.hint">{{ command.hint }}</small>
          </button>
        </li>
        <li
          v-if="props.results.length"
          aria-hidden="true"
          class="search-palette-group"
          role="presentation"
        >
          Notes
        </li>
        <li v-for="result in props.results" :key="`note-${result.id}`">
          <button
            :aria-selected="
              items[activeIndex]?.kind === 'note' &&
              items[activeIndex]?.id === result.id
            "
            class="search-palette-option"
            role="option"
            type="button"
            @click="
              activate(visibleCommands.length + props.results.indexOf(result))
            "
          >
            <span>{{ result.label }}</span>
            <small v-if="result.hint">{{ result.hint }}</small>
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
  z-index: var(--synapse-z-overlay);
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

.search-palette-group {
  padding: 0.35rem 0.65rem 0.2rem;
  color: var(--synapse-color-text-muted);
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.1em;
  text-transform: uppercase;
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
