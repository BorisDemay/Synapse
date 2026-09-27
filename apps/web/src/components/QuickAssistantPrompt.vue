<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import {
  DialogFocusController,
  pushOverlay,
  type OverlayHandle,
} from "@synapse/ui";
import type { CodexModelOption } from "../ai/codex-client";

const props = withDefaults(
  defineProps<{
    activeNote: boolean;
    busy?: boolean;
    connected: boolean;
    model: string;
    models: CodexModelOption[];
    open: boolean;
  }>(),
  { activeNote: false, busy: false },
);

const emit = defineEmits<{
  close: [];
  submit: [payload: { model: string; prompt: string }];
}>();

const prompt = ref("");
const selectedModel = ref("");
const dialogElement = ref<HTMLElement>();
const promptInput = ref<HTMLInputElement>();
const overlay = ref<OverlayHandle>();
const dialogFocus = new DialogFocusController({
  getContainer: () => dialogElement.value ?? null,
});
const canSubmit = computed(
  () =>
    props.connected &&
    !props.busy &&
    props.models.length > 0 &&
    Boolean(prompt.value.trim()) &&
    Boolean(selectedModel.value.trim()),
);
const unavailableHint = computed(() =>
  !props.connected
    ? "Connectez l’assistant dans les paramètres pour envoyer un prompt."
    : !props.models.length
      ? "Aucun modèle disponible."
      : "",
);

function syncSelectedModel() {
  selectedModel.value =
    props.models.find((option) => option.id === props.model)?.id ??
    props.models[0]?.id ??
    "";
}
function openOverlay() {
  overlay.value ??= pushOverlay({
    label: "quick-assistant-prompt",
    lockScroll: true,
    onEscape: () => emit("close"),
  });
}
function closeOverlay() {
  overlay.value?.release();
  overlay.value = undefined;
}
function submitPrompt() {
  if (canSubmit.value)
    emit("submit", {
      model: selectedModel.value.trim(),
      prompt: prompt.value.trim(),
    });
}

onBeforeUnmount(() => {
  closeOverlay();
  dialogFocus.detach();
});
watch(
  () => [props.open, props.model, props.models] as const,
  async ([open]) => {
    if (open) {
      syncSelectedModel();
      openOverlay();
      await nextTick();
      if (props.open) {
        dialogFocus.attach();
        promptInput.value?.focus();
      }
      return;
    }
    closeOverlay();
    prompt.value = "";
    await nextTick();
    dialogFocus.detach();
  },
  { immediate: true },
);
</script>

<template>
  <div
    v-if="open"
    class="quick-assistant-backdrop"
    role="presentation"
    :style="{ zIndex: overlay?.zIndex }"
    @click.self="emit('close')"
  >
    <section
      ref="dialogElement"
      aria-labelledby="quick-assistant-title"
      class="quick-assistant-prompt"
      role="dialog"
      aria-modal="true"
    >
      <header class="quick-assistant-header">
        <h2 id="quick-assistant-title">Prompt rapide à l’assistant</h2>
        <button
          aria-label="Fermer le prompt rapide"
          class="quick-assistant-close"
          type="button"
          @click="emit('close')"
        >
          ×
        </button>
      </header>
      <form class="quick-assistant-form" @submit.prevent="submitPrompt">
        <input
          ref="promptInput"
          v-model="prompt"
          aria-label="Prompt à envoyer à l’assistant"
          class="quick-assistant-input"
          type="text"
          placeholder="Que doit faire l’assistant ?"
        />
        <label class="quick-assistant-model"
          ><span>Modèle</span
          ><select v-model="selectedModel" aria-label="Modèle de l’assistant">
            <option
              v-for="option in props.models"
              :key="option.id"
              :value="option.id"
            >
              {{ option.label }}
            </option>
          </select></label
        >
        <p class="quick-assistant-consent" role="note">
          {{
            props.activeNote
              ? "Avant l’envoi : le texte en clair de la note actuellement ouverte (y compris son brouillon enregistré juste avant l’envoi) sera transmis par cet appareil au fournisseur d’IA configuré."
              : "Aucune note active ne sera transmise comme contexte. Vous pouvez demander à l’assistant de créer une note."
          }}
        </p>
        <p v-if="unavailableHint" class="quick-assistant-hint" role="status">
          {{ unavailableHint }}
        </p>
        <button
          class="quick-assistant-submit"
          type="submit"
          :disabled="!canSubmit"
        >
          Envoyer
        </button>
      </form>
    </section>
  </div>
</template>

<style scoped>
.quick-assistant-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--synapse-z-overlay);
  display: grid;
  place-items: start center;
  padding-top: 12vh;
  background: rgb(15 23 42 / 35%);
}
.quick-assistant-prompt {
  display: grid;
  gap: 0.85rem;
  width: min(32rem, calc(100vw - 2rem));
  padding: 1rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-md);
  background: var(--synapse-color-surface-raised);
  box-shadow: var(--synapse-shadow-md);
}
.quick-assistant-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.quick-assistant-header h2 {
  margin: 0;
  font-size: 0.95rem;
}
.quick-assistant-close {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: transparent;
  font: inherit;
  font-size: 1.15rem;
  line-height: 1;
  cursor: pointer;
}
.quick-assistant-close:hover,
.quick-assistant-close:focus-visible {
  border-color: var(--synapse-color-accent);
  color: var(--synapse-color-text);
}
.quick-assistant-form {
  display: grid;
  gap: 0.65rem;
}
.quick-assistant-input,
.quick-assistant-model select {
  width: 100%;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  background: var(--synapse-color-surface);
  color: var(--synapse-color-text);
  font: inherit;
}
.quick-assistant-input:focus-visible,
.quick-assistant-model select:focus-visible {
  border-color: var(--synapse-color-accent);
  outline: none;
}
.quick-assistant-model {
  display: grid;
  gap: 0.3rem;
  color: var(--synapse-color-text-muted);
  font-size: 0.78rem;
  font-weight: 600;
}
.quick-assistant-consent {
  margin: 0;
  padding: 0.65rem;
  border-inline-start: 3px solid var(--synapse-color-accent);
  color: var(--synapse-color-text);
  font-size: 0.8rem;
  line-height: 1.45;
}
.quick-assistant-hint {
  margin: 0;
  color: var(--synapse-color-text-muted);
  font-size: 0.78rem;
  line-height: 1.45;
}
.quick-assistant-submit {
  justify-self: end;
  padding: 0.55rem 0.95rem;
  border: 1px solid
    color-mix(
      in srgb,
      var(--synapse-color-accent) 35%,
      var(--synapse-color-border)
    );
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-accent-contrast);
  background: var(--synapse-color-accent);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}
.quick-assistant-submit:hover:not(:disabled) {
  background: var(--synapse-color-accent-strong);
}
.quick-assistant-submit:focus-visible {
  outline: 2px solid var(--synapse-color-accent);
  outline-offset: 1px;
}
.quick-assistant-submit:disabled {
  color: var(--synapse-color-text-muted);
  background: var(--synapse-color-surface-muted);
  cursor: not-allowed;
}
</style>
