<script setup lang="ts">
import { computed, ref, watch } from "vue";

export interface AiChatMessage {
  content: string;
  id: string;
  role: "assistant" | "user";
}

export interface AiChatAttachment {
  id: string;
  label: string;
}

export interface AiChatModelOption {
  id: string;
  label: string;
}

export interface AiChatReasoningLevel {
  id: string;
  label: string;
}

const props = defineProps<{
  attachments: AiChatAttachment[];
  busy?: boolean;
  connected: boolean;
  conversationsPanelOpen?: boolean;
  deviceLogin?: { userCode: string; verificationUrl: string } | null;
  error?: string;
  fast?: boolean;
  fastAvailable?: boolean;
  fastLabel?: string;
  historyPanelOpen?: boolean;
  messages: AiChatMessage[];
  model?: string;
  models?: AiChatModelOption[];
  reasoningEffort?: string;
  reasoningLevels?: AiChatReasoningLevel[];
}>();

const emit = defineEmits<{
  cancelChatgpt: [];
  connect: [token: string];
  connectChatgpt: [];
  closePanel: [];
  detach: [id: string];
  disconnect: [];
  send: [prompt: string];
  toggleConversations: [];
  toggleHistory: [];
  "update:fast": [fast: boolean];
  "update:model": [model: string];
  "update:reasoningEffort": [effort: string];
}>();

const token = ref("");
const model = ref(props.model ?? "");
const draft = ref("");
const modelOptions = computed(() => props.models ?? []);
const reasoningLevels = computed(() => props.reasoningLevels ?? []);
const reasoningIndex = computed(() => {
  const index = reasoningLevels.value.findIndex(
    (level) => level.id === props.reasoningEffort,
  );
  return index >= 0 ? index : 0;
});
const reasoningLabel = computed(
  () => reasoningLevels.value[reasoningIndex.value]?.label ?? "",
);
const showReasoning = computed(() => reasoningLevels.value.length > 1);
const showFast = computed(() =>
  Boolean(props.fastAvailable && props.fastLabel),
);

watch(
  () => props.model,
  (next) => {
    if (next) {
      model.value = next;
    }
  },
);

function submitConnect() {
  emit("connect", token.value);
  token.value = "";
}

function onModelChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  model.value = value;
  emit("update:model", value);
}

function onReasoningChange(event: Event) {
  const index = Number((event.target as HTMLInputElement).value);
  const level = reasoningLevels.value[index];
  if (level) {
    emit("update:reasoningEffort", level.id);
  }
}

function onFastChange(event: Event) {
  emit("update:fast", (event.target as HTMLInputElement).checked);
}

function submitPrompt() {
  const prompt = draft.value.trim();
  if (!prompt || props.busy) {
    return;
  }
  emit("send", prompt);
  draft.value = "";
}
</script>

<template>
  <section class="ai-chat" aria-label="Chat Codex">
    <header class="ai-chat-header">
      <div class="ai-chat-title">
        <span class="ai-chat-avatar" aria-hidden="true">✦</span>
        <div>
          <span class="ai-chat-eyebrow">ASSISTANT</span>
          <h2>Codex</h2>
        </div>
      </div>
      <span
        class="ai-chat-status"
        :class="connected ? 'is-online' : 'is-offline'"
      >
        <span class="ai-chat-status-dot" aria-hidden="true" />
        {{ connected ? "Connecté" : "Hors ligne" }}
      </span>
      <div v-if="connected" class="ai-chat-panel-controls">
        <button
          :aria-pressed="Boolean(conversationsPanelOpen)"
          aria-label="Afficher ou masquer les conversations"
          class="ai-chat-icon-button"
          name="toggle-codex-conversations"
          title="Conversations"
          type="button"
          @click="emit('toggleConversations')"
        >
          ☷
        </button>
        <button
          :aria-pressed="Boolean(historyPanelOpen)"
          aria-label="Afficher ou masquer l’historique de la note"
          class="ai-chat-icon-button"
          name="toggle-note-history"
          title="Historique de la note"
          type="button"
          @click="emit('toggleHistory')"
        >
          ◫
        </button>
        <button
          aria-label="Fermer Codex"
          class="ai-chat-icon-button"
          name="close-codex-panel"
          title="Fermer Codex"
          type="button"
          @click="emit('closePanel')"
        >
          ×
        </button>
      </div>
      <button
        v-if="connected"
        class="ai-chat-text-button"
        type="button"
        @click="emit('disconnect')"
      >
        Déconnecter
      </button>
    </header>

    <p class="ai-chat-notice" role="note">
      <span class="ai-chat-notice-icon" aria-hidden="true">🔒</span>
      Les notes liées quittent cet appareil vers Codex (OpenAI). Elles
      n’empruntent jamais le serveur Synapse.
    </p>

    <div v-if="!connected" class="ai-chat-connect">
      <button
        class="ai-chat-primary ai-chat-primary-lg"
        :disabled="Boolean(deviceLogin)"
        type="button"
        @click="emit('connectChatgpt')"
      >
        Se connecter avec ChatGPT
      </button>
      <p v-if="deviceLogin" class="ai-chat-device" role="status">
        <span class="ai-chat-device-label">Ouvrez</span>
        <a
          class="ai-chat-device-link"
          :href="deviceLogin.verificationUrl"
          rel="noopener noreferrer"
          target="_blank"
          >auth.openai.com/codex/device</a
        >
        <span class="ai-chat-device-label">et saisissez le code</span>
        <strong>{{ deviceLogin.userCode }}</strong>
        <button
          class="ai-chat-text-button"
          type="button"
          @click="emit('cancelChatgpt')"
        >
          Annuler
        </button>
      </p>
      <p class="ai-chat-hint">
        Utilise votre abonnement Codex. Activez le code d’appareil dans les
        paramètres ChatGPT si la connexion est refusée.
      </p>

      <div class="ai-chat-divider"><span>ou</span></div>

      <form class="ai-chat-connect" @submit.prevent="submitConnect">
        <label class="ai-chat-field">
          <span>Clé API Platform</span>
          <input
            v-model="token"
            autocomplete="off"
            name="codex-token"
            placeholder="sk-…"
            required
            type="password"
          />
        </label>
        <button class="ai-chat-secondary" type="submit">
          Connecter avec une clé
        </button>
      </form>
    </div>

    <template v-else>
      <div class="ai-chat-chips">
        <template v-if="attachments.length">
          <span
            v-for="attachment in attachments"
            :key="attachment.id"
            class="ai-chat-chip"
          >
            <span class="ai-chat-chip-label">{{ attachment.label }}</span>
            <button
              type="button"
              :aria-label="`Retirer ${attachment.label}`"
              @click="emit('detach', attachment.id)"
            >
              ×
            </button>
          </span>
        </template>
        <p v-else class="ai-chat-hint ai-chat-hint-chips">
          <span aria-hidden="true">📎</span>
          Ctrl+clic sur une note pour la lier à Codex.
        </p>
      </div>

      <div
        v-if="modelOptions.length || showReasoning || showFast"
        class="ai-chat-controls"
      >
        <label v-if="modelOptions.length" class="ai-chat-field">
          <span>Modèle</span>
          <div class="ai-chat-select">
            <select
              :value="model"
              name="codex-model-select"
              @change="onModelChange"
            >
              <option
                v-for="option in modelOptions"
                :key="option.id"
                :value="option.id"
              >
                {{ option.label }}
              </option>
            </select>
            <span class="ai-chat-select-caret" aria-hidden="true">▾</span>
          </div>
        </label>

        <label v-if="showReasoning" class="ai-chat-field">
          <span class="ai-chat-field-row">
            Profondeur
            <em class="ai-chat-badge">{{ reasoningLabel }}</em>
          </span>
          <input
            :aria-valuetext="reasoningLabel"
            :max="reasoningLevels.length - 1"
            :value="reasoningIndex"
            class="ai-chat-range"
            min="0"
            name="codex-reasoning"
            step="1"
            type="range"
            @input="onReasoningChange"
          />
        </label>

        <label v-if="showFast" class="ai-chat-switch">
          <span class="ai-chat-switch-text">
            <span aria-hidden="true">⚡</span>
            {{ fastLabel }}
          </span>
          <input
            :aria-checked="Boolean(fast)"
            :checked="fast"
            name="codex-fast"
            role="switch"
            type="checkbox"
            @change="onFastChange"
          />
        </label>
      </div>

      <div class="ai-chat-thread" role="log" aria-live="polite">
        <p v-if="messages.length === 0" class="ai-chat-empty">
          <span class="ai-chat-empty-icon" aria-hidden="true">✎</span>
          Décrivez l’action à effectuer. Codex créera ou modifiera la note liée.
        </p>
        <article
          v-for="message in messages"
          :key="message.id"
          class="ai-chat-bubble"
          :data-role="message.role"
        >
          <span class="ai-chat-bubble-author">
            {{ message.role === "user" ? "Vous" : "Codex" }}
          </span>
          <pre>{{ message.content }}</pre>
        </article>
      </div>

      <form class="ai-chat-composer" @submit.prevent="submitPrompt">
        <label class="ai-chat-field">
          <span class="visually-hidden">Message pour Codex</span>
          <textarea
            v-model="draft"
            :disabled="busy"
            name="codex-prompt"
            placeholder="Créez ou modifiez une note…"
            rows="3"
            @keydown.enter.exact.prevent="submitPrompt"
          />
        </label>
        <button class="ai-chat-primary" :disabled="busy" type="submit">
          <span v-if="busy" class="ai-chat-spinner" aria-hidden="true" />
          {{ busy ? "…" : "Envoyer" }}
        </button>
      </form>
    </template>

    <p v-if="error" class="ai-chat-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.ai-chat {
  display: grid;
  align-content: start;
  gap: 0.95rem;
  width: 100%;
  min-width: 0;
  padding: clamp(0.85rem, 2vw, 1.25rem);
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-lg);
  background:
    radial-gradient(
      circle at 100% 0%,
      color-mix(in srgb, var(--synapse-color-accent) 12%, transparent),
      transparent 14rem
    ),
    var(--synapse-color-surface-raised);
  box-shadow: var(--synapse-shadow-md);
}

.ai-chat-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.ai-chat-title {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-inline-end: auto;
}

.ai-chat-avatar {
  display: grid;
  place-items: center;
  width: 2.3rem;
  height: 2.3rem;
  border-radius: var(--synapse-radius-md);
  color: var(--synapse-color-accent-contrast);
  background: linear-gradient(
    135deg,
    var(--synapse-color-accent),
    var(--synapse-color-accent-strong)
  );
  font-size: 1.1rem;
  box-shadow: var(--synapse-shadow-sm);
}

.ai-chat-header h2 {
  margin: 0;
  font-size: 1.15rem;
  letter-spacing: -0.04em;
}

.ai-chat-eyebrow {
  display: block;
  color: var(--synapse-color-text-muted);
  font-size: 0.62rem;
  font-weight: 750;
  letter-spacing: 0.14em;
}

.ai-chat-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 650;
  background: var(--synapse-color-surface-muted);
  color: var(--synapse-color-text-muted);
}

.ai-chat-status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: currentcolor;
}

.ai-chat-status.is-online {
  color: var(--synapse-color-success);
  background: color-mix(
    in srgb,
    var(--synapse-color-success) 12%,
    var(--synapse-color-surface-raised)
  );
}

.ai-chat-panel-controls {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}

.ai-chat-icon-button {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: transparent;
  font: inherit;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.ai-chat-icon-button:hover,
.ai-chat-icon-button[aria-pressed="true"] {
  border-color: var(--synapse-color-border);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-muted);
}

.ai-chat-icon-button:focus-visible {
  outline: 2px solid var(--synapse-color-accent);
  outline-offset: 1px;
}

.ai-chat-notice,
.ai-chat-hint,
.ai-chat-error {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.45;
}

.ai-chat-notice {
  display: flex;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: var(--synapse-color-surface-muted);
}

.ai-chat-notice-icon {
  flex: 0 0 auto;
}

.ai-chat-hint {
  color: var(--synapse-color-text-muted);
}

.ai-chat-hint-chips {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.ai-chat-device {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  padding: 0.75rem 0.85rem;
  border: 1px solid
    color-mix(
      in srgb,
      var(--synapse-color-accent) 30%,
      var(--synapse-color-border)
    );
  border-radius: var(--synapse-radius-md);
  background: var(--synapse-color-surface-accent);
  font-size: 0.85rem;
}

.ai-chat-device-label {
  color: var(--synapse-color-text-muted);
}

.ai-chat-device strong {
  padding: 0.15rem 0.5rem;
  border-radius: var(--synapse-radius-sm);
  background: var(--synapse-color-surface-raised);
  font-size: 1.05rem;
  letter-spacing: 0.12em;
}

.ai-chat-device-link {
  color: var(--synapse-color-accent-strong);
  font-weight: 650;
}

.ai-chat-divider {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--synapse-color-text-muted);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.ai-chat-divider::before,
.ai-chat-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--synapse-color-border);
}

.ai-chat-connect,
.ai-chat-composer,
.ai-chat-field {
  display: grid;
  gap: 0.45rem;
}

.ai-chat-controls {
  display: grid;
  gap: 0.75rem;
  padding: 0.85rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-md);
  background: color-mix(
    in srgb,
    var(--synapse-color-surface-muted) 60%,
    var(--synapse-color-surface-raised)
  );
}

.ai-chat-field span {
  color: var(--synapse-color-text-muted);
  font-size: 0.75rem;
  font-weight: 650;
}

.ai-chat-field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.ai-chat-badge {
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  color: var(--synapse-color-accent-strong);
  background: color-mix(in srgb, var(--synapse-color-accent) 15%, transparent);
  font-size: 0.7rem;
  font-style: normal;
  font-weight: 700;
}

.ai-chat-field input,
.ai-chat-field textarea,
.ai-chat-field select {
  width: 100%;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
  font: inherit;
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease;
}

.ai-chat-field input:focus-visible,
.ai-chat-field textarea:focus-visible,
.ai-chat-field select:focus-visible {
  border-color: var(--synapse-color-accent);
  box-shadow: 0 0 0 3px
    color-mix(in srgb, var(--synapse-color-accent) 18%, transparent);
  outline: 0;
}

.ai-chat-select {
  position: relative;
  display: flex;
}

.ai-chat-select select {
  appearance: none;
  padding-inline-end: 2.25rem;
}

.ai-chat-select-caret {
  position: absolute;
  top: 50%;
  right: 0.85rem;
  transform: translateY(-50%);
  color: var(--synapse-color-text-muted);
  pointer-events: none;
}

.ai-chat-range {
  width: 100%;
  padding: 0.35rem 0;
  border: 0;
  background: transparent;
  accent-color: var(--synapse-color-accent);
  cursor: pointer;
}

.ai-chat-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: var(--synapse-color-text);
  font-size: 0.8rem;
  font-weight: 650;
}

.ai-chat-switch-text {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.ai-chat-switch input {
  appearance: none;
  width: 2.5rem;
  height: 1.4rem;
  flex: 0 0 auto;
  border: 0;
  border-radius: 999px;
  background: var(--synapse-color-border);
  cursor: pointer;
  transition: background 0.15s ease;
}

.ai-chat-switch input::after {
  content: "";
  display: block;
  width: 1.1rem;
  height: 1.1rem;
  margin: 0.15rem;
  border-radius: 999px;
  background: var(--synapse-color-surface-raised);
  box-shadow: var(--synapse-shadow-sm);
  transition: transform 0.15s ease;
}

.ai-chat-switch input:checked {
  background: var(--synapse-color-accent);
}

.ai-chat-switch input:checked::after {
  transform: translateX(1.1rem);
}

.ai-chat-primary,
.ai-chat-secondary,
.ai-chat-text-button,
.ai-chat-actions button,
.ai-chat-chip button {
  font: inherit;
  cursor: pointer;
}

.ai-chat-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-height: 2.6rem;
  border: 1px solid var(--synapse-color-accent);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-accent-contrast);
  background: linear-gradient(
    135deg,
    var(--synapse-color-accent),
    var(--synapse-color-accent-strong)
  );
  font-weight: 700;
  transition:
    transform 140ms ease,
    filter 140ms ease;
}

.ai-chat-primary:hover:not(:disabled) {
  filter: brightness(1.05);
}

.ai-chat-primary:active:not(:disabled) {
  transform: translateY(1px);
}

.ai-chat-primary-lg {
  min-height: 3rem;
  font-size: 0.95rem;
}

.ai-chat-primary:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.ai-chat-secondary {
  min-height: 2.6rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
  font-weight: 650;
  transition: border-color 140ms ease;
}

.ai-chat-secondary:hover {
  border-color: var(--synapse-color-accent);
}

.ai-chat-text-button {
  border: 0;
  border-radius: var(--synapse-radius-sm);
  padding: 0.3rem 0.5rem;
  color: var(--synapse-color-text-muted);
  background: transparent;
}

.ai-chat-text-button:hover {
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-muted);
}

.ai-chat-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  min-height: 1.6rem;
}

.ai-chat-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 100%;
  padding: 0.25rem 0.3rem 0.25rem 0.6rem;
  border-radius: 999px;
  background: var(--synapse-color-surface-accent);
  font-size: 0.75rem;
}

.ai-chat-chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-chat-chip button {
  display: grid;
  place-items: center;
  width: 1.2rem;
  height: 1.2rem;
  border: 0;
  border-radius: 999px;
  color: var(--synapse-color-text-muted);
  background: color-mix(
    in srgb,
    var(--synapse-color-text-muted) 15%,
    transparent
  );
  line-height: 1;
}

.ai-chat-chip button:hover {
  color: var(--synapse-color-danger);
}

.ai-chat-thread {
  display: grid;
  gap: 0.6rem;
  align-content: start;
  max-height: min(46vh, 30rem);
  padding: 0.35rem;
  overflow: auto;
  scrollbar-width: thin;
}

.ai-chat-empty {
  display: grid;
  justify-items: center;
  gap: 0.4rem;
  margin: 0;
  padding: 1.75rem 1rem;
  border: 1px dashed var(--synapse-color-border);
  border-radius: var(--synapse-radius-md);
  color: var(--synapse-color-text-muted);
  font-size: 0.82rem;
  text-align: center;
}

.ai-chat-empty-icon {
  font-size: 1.4rem;
}

.ai-chat-bubble {
  display: grid;
  gap: 0.3rem;
  max-width: 92%;
  padding: 0.65rem 0.8rem;
  border-radius: var(--synapse-radius-md);
  background: var(--synapse-color-surface-muted);
}

.ai-chat-bubble[data-role="user"] {
  justify-self: end;
  color: var(--synapse-color-accent-contrast);
  background: linear-gradient(
    135deg,
    var(--synapse-color-accent),
    var(--synapse-color-accent-strong)
  );
  border-bottom-right-radius: var(--synapse-radius-sm);
}

.ai-chat-bubble[data-role="assistant"] {
  justify-self: start;
  border: 1px solid var(--synapse-color-border);
  background: var(--synapse-color-surface-raised);
  border-bottom-left-radius: var(--synapse-radius-sm);
}

.ai-chat-bubble-author {
  font-size: 0.66rem;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.8;
}

.ai-chat-bubble pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  font-size: 0.88rem;
  line-height: 1.5;
}

.ai-chat-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.ai-chat-actions button {
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: 999px;
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
  font-size: 0.75rem;
  transition:
    border-color 140ms ease,
    background 140ms ease;
}

.ai-chat-actions button:hover {
  border-color: var(--synapse-color-accent);
  background: var(--synapse-color-surface-accent);
}

.ai-chat-composer {
  gap: 0.55rem;
}

.ai-chat-composer textarea {
  resize: vertical;
  min-height: 3.25rem;
}

.ai-chat-spinner {
  width: 0.9rem;
  height: 0.9rem;
  border: 2px solid color-mix(in srgb, currentcolor 35%, transparent);
  border-top-color: currentcolor;
  border-radius: 999px;
  animation: ai-chat-spin 0.7s linear infinite;
}

@keyframes ai-chat-spin {
  to {
    transform: rotate(1turn);
  }
}

.ai-chat-error {
  padding: 0.6rem 0.75rem;
  border: 1px solid
    color-mix(
      in srgb,
      var(--synapse-color-danger) 35%,
      var(--synapse-color-border)
    );
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-danger);
  background: color-mix(
    in srgb,
    var(--synapse-color-danger) 9%,
    var(--synapse-color-surface-raised)
  );
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

@media (max-width: 30rem) {
  .ai-chat {
    padding: 0.85rem;
  }

  .ai-chat-bubble {
    max-width: 100%;
  }

  .ai-chat-actions button {
    flex: 1 1 auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-chat-primary,
  .ai-chat-switch input,
  .ai-chat-switch input::after,
  .ai-chat-spinner {
    transition: none;
    animation: none;
  }
}
</style>
