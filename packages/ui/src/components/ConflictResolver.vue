<script setup lang="ts">
const props = defineProps<{
  base: string;
  local: string;
  remote: string;
  manualDraft?: string;
}>();

const emit = defineEmits<{
  "keep-local": [];
  "keep-remote": [];
  "edit-manual": [];
  "update:manualDraft": [value: string];
}>();

function confirmAction(
  message: string,
  event: "keep-local" | "keep-remote" | "edit-manual",
) {
  if (!confirm(message)) {
    return;
  }
  if (event === "keep-local") {
    emit("keep-local");
  } else if (event === "keep-remote") {
    emit("keep-remote");
  } else {
    emit("edit-manual");
  }
}
</script>

<template>
  <section class="conflict-resolver" aria-label="Résolution de conflit" role="region">
    <h2>Conflit de synchronisation</h2>
    <p>
      Trois versions chiffrées ont divergé. Choisissez explicitement une résolution ;
      l’historique n’est pas écrasé.
    </p>

    <div class="conflict-panes">
      <article>
        <h3>Base</h3>
        <pre aria-label="Version de base">{{ props.base }}</pre>
      </article>
      <article>
        <h3>Locale</h3>
        <pre aria-label="Version locale">{{ props.local }}</pre>
      </article>
      <article>
        <h3>Distante</h3>
        <pre aria-label="Version distante">{{ props.remote }}</pre>
      </article>
    </div>

    <label class="manual-edit">
      Édition manuelle
      <textarea
        :value="props.manualDraft ?? props.local"
        aria-label="Brouillon de résolution"
        @input="
          emit(
            'update:manualDraft',
            ($event.target as HTMLTextAreaElement).value,
          )
        "
      />
    </label>

    <div class="conflict-actions">
      <button
        type="button"
        aria-label="Garder la version locale"
        @click="
          confirmAction(
            'Confirmer : garder la version locale et créer une nouvelle révision ?',
            'keep-local',
          )
        "
      >
        Garder local
      </button>
      <button
        type="button"
        aria-label="Garder la version distante"
        @click="
          confirmAction(
            'Confirmer : garder la version distante et créer une nouvelle révision ?',
            'keep-remote',
          )
        "
      >
        Garder distant
      </button>
      <button
        type="button"
        aria-label="Édition manuelle"
        @click="
          confirmAction(
            'Confirmer : publier le brouillon manuel comme nouvelle révision ?',
            'edit-manual',
          )
        "
      >
        Publier le brouillon
      </button>
    </div>
  </section>
</template>

<style scoped>
.conflict-resolver {
  display: grid;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid #b8c2cc;
  background: #f7fafc;
}

.conflict-panes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.conflict-panes pre {
  margin: 0;
  padding: 0.5rem;
  min-height: 8rem;
  overflow: auto;
  white-space: pre-wrap;
  background: #fff;
  border: 1px solid #c5ced6;
  font-family: "IBM Plex Mono", Consolas, monospace;
  font-size: 0.85rem;
}

.manual-edit {
  display: grid;
  gap: 0.35rem;
}

.manual-edit textarea {
  min-height: 6rem;
  font: inherit;
}

.conflict-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

@media (max-width: 900px) {
  .conflict-panes {
    grid-template-columns: 1fr;
  }
}
</style>
