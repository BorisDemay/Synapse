<script setup lang="ts">
import { readableLineDiff } from "../markdown/diff";
import { computed } from "vue";
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

const localDiff = computed(() => readableLineDiff(props.base, props.local));
const remoteDiff = computed(() => readableLineDiff(props.base, props.remote));

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
  <section
    class="conflict-resolver"
    aria-label="Résolution de conflit"
    role="region"
  >
    <div class="conflict-heading">
      <span class="conflict-icon" aria-hidden="true">!</span>
      <div>
        <h2>Conflit de synchronisation</h2>
        <p>
          Trois versions chiffrées ont divergé. Choisissez explicitement une
          résolution ; l’historique n’est pas écrasé.
        </p>
      </div>
    </div>

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
    <div class="conflict-diffs" aria-label="Diffs lisibles">
      <article>
        <h3>Changements locaux</h3>
        <pre><span v-for="(line, index) in localDiff" :key="`local-${index}`" :data-kind="line.kind">{{ line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " " }} {{ line.text }}
</span></pre>
      </article>
      <article>
        <h3>Changements distants</h3>
        <pre><span v-for="(line, index) in remoteDiff" :key="`remote-${index}`" :data-kind="line.kind">{{ line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " " }} {{ line.text }}
</span></pre>
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
        class="action-primary"
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
        class="action-secondary"
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
        class="action-secondary"
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
  min-height: 0;
  overflow: auto;
  display: grid;
  gap: 1.25rem;
  padding: clamp(1rem, 3vw, 1.75rem);
  border: 1px solid
    color-mix(
      in srgb,
      var(--synapse-color-warning) 35%,
      var(--synapse-color-border)
    );
  border-radius: var(--synapse-radius-md);
  background: color-mix(
    in srgb,
    var(--synapse-color-warning) 7%,
    var(--synapse-color-surface-raised)
  );
  box-shadow: var(--synapse-shadow-sm);
}

.conflict-heading {
  display: flex;
  gap: 0.85rem;
  align-items: flex-start;
}

.conflict-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  color: #fff;
  background: var(--synapse-color-warning);
  font-weight: 800;
}

.conflict-resolver h2 {
  margin: 0;
  font-size: 1.25rem;
}

.conflict-resolver p {
  margin: 0.3rem 0 0;
  color: var(--synapse-color-text-muted);
  line-height: 1.55;
}

.conflict-panes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.conflict-diffs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}
.conflict-diffs h3 {
  margin: 0 0 0.35rem;
  font-size: 0.9rem;
}
.conflict-diffs pre {
  margin: 0;
  max-height: 14rem;
  overflow: auto;
  white-space: pre-wrap;
}
.conflict-diffs [data-kind="added"] {
  color: #18794e;
  background: color-mix(in srgb, #22c55e 15%, transparent);
}
.conflict-diffs [data-kind="removed"] {
  color: #b42318;
  background: color-mix(in srgb, #ef4444 15%, transparent);
}

.conflict-panes pre {
  margin: 0;
  padding: 0.5rem;
  min-height: 8rem;
  overflow: auto;
  white-space: pre-wrap;
  background: var(--synapse-color-surface-raised);
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  font-family: var(--synapse-font-mono);
  font-size: 0.85rem;
}

.manual-edit {
  display: grid;
  gap: 0.35rem;
}

.manual-edit textarea {
  min-height: 6rem;
  padding: 0.75rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
  font: inherit;
  resize: vertical;
}

.conflict-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.conflict-actions button {
  min-height: 2.6rem;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  cursor: pointer;
  font-weight: 650;
}

.action-primary {
  color: var(--synapse-color-accent-contrast);
  background: var(--synapse-color-accent);
  border-color: var(--synapse-color-accent) !important;
}

.action-secondary {
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
}

@media (max-width: 900px) {
  .conflict-panes {
    grid-template-columns: 1fr;
  }
  .conflict-diffs {
    grid-template-columns: 1fr;
  }
}
</style>
