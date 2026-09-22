<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

interface DeletedItem {
  id: string;
  label: string;
  path: string;
  kind: "note" | "attachment";
  recoverable: boolean;
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    items: DeletedItem[];
    loading?: boolean;
    restoring?: boolean;
    error?: string;
  }>(),
  { loading: false, restoring: false, error: "" },
);
const emit = defineEmits<{ close: []; restore: [id: string] }>();
const dialog = ref<HTMLDialogElement>();

watch(
  () => props.open,
  async (open) => {
    await nextTick();
    if (open && props.open && !dialog.value?.open) dialog.value?.showModal();
    else if (!props.open && dialog.value?.open) dialog.value.close();
  },
  { immediate: true },
);
onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
  <dialog
    ref="dialog"
    class="deleted-items-panel"
    aria-labelledby="deleted-items-title"
    aria-describedby="deleted-items-help"
    @cancel.prevent="emit('close')"
    @click.self="emit('close')"
  >
    <template v-if="open">
      <header>
        <h2 id="deleted-items-title">Éléments supprimés</h2>
        <button
          type="button"
          autofocus
          aria-label="Fermer les éléments supprimés"
          @click="emit('close')"
        >
          ×
        </button>
      </header>
      <p id="deleted-items-help">
        Restaurez les versions encore présentes dans l’historique chiffré de cet
        appareil. Ce n’est pas une sauvegarde : effacer les données locales ou
        utiliser un autre appareil peut rendre ces versions indisponibles.
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="loading || restoring" role="status">
        {{
          restoring
            ? "Restauration en cours…"
            : "Recherche dans l’historique local…"
        }}
      </p>
      <p v-else-if="!items.length" role="status">
        Aucun élément supprimé sur cet appareil.
      </p>
      <ul v-if="!loading">
        <li v-for="item in items" :key="item.id">
          <div>
            <strong>{{ item.label }}</strong>
            <span v-if="item.path" class="deleted-item-path">{{
              item.path
            }}</span>
            <small>{{
              item.kind === "attachment" ? "Pièce jointe" : "Note"
            }}</small>
            <span v-if="!item.recoverable">Historique local indisponible</span>
          </div>
          <button
            v-if="item.recoverable"
            data-restore
            type="button"
            :disabled="restoring"
            :aria-label="`Restaurer ${item.label}`"
            @click="emit('restore', item.id)"
          >
            Restaurer
          </button>
        </li>
      </ul>
    </template>
  </dialog>
</template>

<style scoped>
.deleted-items-panel {
  width: min(42rem, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  margin: auto;
  padding: 1.25rem;
  overflow: auto;
  border: 1px solid var(--synapse-color-border);
  border-radius: 1rem;
  background: var(--synapse-color-surface);
  color: var(--synapse-color-text);
}
.deleted-items-panel::backdrop {
  background: rgb(0 0 0 / 55%);
}
header,
li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
h2 {
  margin: 0;
}
p {
  line-height: 1.5;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
li {
  padding: 1rem 0;
  border-top: 1px solid var(--synapse-color-border);
}
li > div {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
}
.deleted-item-path {
  overflow-wrap: anywhere;
}
small,
.deleted-item-path,
#deleted-items-help {
  color: var(--synapse-color-text-muted);
}
button {
  flex-shrink: 0;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
}
button:disabled {
  cursor: wait;
}
[role="alert"] {
  color: var(--synapse-color-danger);
}
</style>
