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
          Synapse a conservé les trois versions. Comparez ce qui a changé sur
          cet appareil et à distance, puis publiez une nouvelle révision.
        </p>
      </div>
    </div>

    <div class="conflict-version-grid">
      <article class="conflict-card">
        <h3>Base</h3>
        <pre aria-label="Version de base">{{ props.base }}</pre>
      </article>
      <article class="conflict-card">
        <h3>Sur cet appareil</h3>
        <pre aria-label="Version locale">{{ props.local }}</pre>
      </article>
      <article class="conflict-card">
        <h3>À distance</h3>
        <pre aria-label="Version distante">{{ props.remote }}</pre>
      </article>
    </div>
    <div class="conflict-diff-grid" aria-label="Diffs lisibles">
      <article class="conflict-card">
        <h3>Ce qui a changé sur cet appareil</h3>
        <pre><span v-for="(line, index) in localDiff" :key="`local-${index}`" :data-kind="line.kind">{{ line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " " }} {{ line.text }}
</span></pre>
      </article>
      <article class="conflict-card">
        <h3>Ce qui a changé à distance</h3>
        <pre><span v-for="(line, index) in remoteDiff" :key="`remote-${index}`" :data-kind="line.kind">{{ line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " " }} {{ line.text }}
</span></pre>
      </article>
    </div>

    <label class="manual-edit conflict-card conflict-manual-card">
      <span>Édition manuelle</span>
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

    <div class="conflict-actions conflict-card">
      <p class="conflict-action-hint">
        Chaque choix crée une nouvelle révision chiffrée ; les variantes restent
        disponibles dans l’historique local.
      </p>
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
        aria-label="Publier le brouillon"
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
  align-self: start;
  justify-self: center;
  min-height: 0;
  max-height: calc(100dvh - 8rem);
  width: min(68rem, calc(100% - clamp(2rem, 6vw, 4rem)));
  margin: clamp(1.25rem, 4vh, 2.25rem) 0;
  overflow: auto;
  display: grid;
  gap: 1rem;
  padding: clamp(1rem, 3vw, 1.5rem);
  border: 1px solid
    color-mix(
      in srgb,
      var(--synapse-color-warning) 32%,
      var(--synapse-color-border)
    );
  border-radius: var(--synapse-radius-lg);
  background: color-mix(
    in srgb,
    var(--synapse-color-warning) 5%,
    var(--synapse-color-surface-raised)
  );
  box-shadow: var(--synapse-shadow-md);
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

.conflict-version-grid,
.conflict-diff-grid {
  display: grid;
  gap: 0.85rem;
}

.conflict-version-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.conflict-diff-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.conflict-card {
  display: grid;
  gap: 0.55rem;
  min-width: 0;
  padding: 0.85rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-md);
  background: color-mix(
    in srgb,
    var(--synapse-color-surface-raised) 82%,
    var(--synapse-color-surface)
  );
}

.conflict-card h3 {
  margin: 0;
  font-size: 0.9rem;
}

.conflict-card pre {
  margin: 0;
  min-height: 7rem;
  max-height: 12rem;
  padding: 0.65rem;
  overflow: auto;
  white-space: pre-wrap;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  background: var(--synapse-color-surface);
  font-family: var(--synapse-font-mono);
  font-size: 0.84rem;
  line-height: 1.55;
}

.conflict-diff-grid pre {
  min-height: 5rem;
}

.conflict-diff-grid [data-kind="added"] {
  color: #18794e;
  background: color-mix(in srgb, #22c55e 15%, transparent);
}
.conflict-diff-grid [data-kind="removed"] {
  color: #b42318;
  background: color-mix(in srgb, #ef4444 15%, transparent);
}

.manual-edit {
  display: grid;
  gap: 0.55rem;
  font-weight: 650;
}

.manual-edit textarea {
  min-height: 6.5rem;
  padding: 0.75rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface);
  font: inherit;
  font-weight: 400;
  line-height: 1.55;
  resize: vertical;
}

.conflict-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.65rem;
}

.conflict-action-hint {
  flex: 1 1 100%;
  margin: 0 0 0.25rem;
  color: var(--synapse-color-text-muted);
  font-size: 0.9rem;
  line-height: 1.45;
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
  .conflict-resolver {
    width: calc(100% - 1.5rem);
    margin-block: 0.75rem;
    max-height: none;
  }

  .conflict-version-grid,
  .conflict-diff-grid {
    grid-template-columns: 1fr;
  }

  .conflict-actions {
    justify-content: stretch;
  }

  .conflict-actions button {
    flex: 1 1 11rem;
  }
}
</style>
