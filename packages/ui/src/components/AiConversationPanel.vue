<script setup lang="ts">
export interface AiConversationPanelItem {
  id: string;
  title: string;
  updatedAt: number;
}

const props = defineProps<{
  activeConversationId?: string | null;
  busy?: boolean;
  conversations: AiConversationPanelItem[];
}>();

const emit = defineEmits<{
  close: [];
  newConversation: [];
  openConversation: [id: string];
}>();

function openAdjacentConversation(offset: number) {
  const index = props.conversations.findIndex(
    (conversation) => conversation.id === props.activeConversationId,
  );
  const next = props.conversations.at(index + offset);
  if (next) {
    emit("openConversation", next.id);
  }
}
</script>

<template>
  <section class="ai-conversation-panel" aria-label="Conversations Codex">
    <header class="ai-conversation-panel-header">
      <div>
        <span>Codex</span>
        <h2>Conversations</h2>
      </div>
      <div class="ai-conversation-panel-actions">
        <button
          :disabled="busy"
          name="new-codex-conversation"
          type="button"
          @click="emit('newConversation')"
        >
          Nouvelle
        </button>
        <button
          aria-label="Fermer le panneau Conversations"
          class="ai-conversation-panel-close"
          name="close-codex-conversations"
          type="button"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
    </header>

    <div
      v-if="conversations.length"
      class="ai-conversation-tabs"
      role="tablist"
      aria-label="Fils Codex"
      @keydown.left.prevent="openAdjacentConversation(-1)"
      @keydown.right.prevent="openAdjacentConversation(1)"
    >
      <button
        v-for="conversation in conversations"
        :id="`codex-tab-${conversation.id}`"
        :key="conversation.id"
        :aria-controls="`codex-thread-${conversation.id}`"
        :aria-selected="conversation.id === activeConversationId"
        :class="{ 'is-active': conversation.id === activeConversationId }"
        :disabled="busy"
        :name="`codex-conversation-${conversation.id}`"
        :title="conversation.title"
        role="tab"
        type="button"
        @click="emit('openConversation', conversation.id)"
      >
        {{ conversation.title }}
      </button>
    </div>
    <p v-else class="ai-conversation-empty">Aucune conversation enregistrée.</p>
  </section>
</template>

<style scoped>
.ai-conversation-panel {
  display: grid;
  align-content: start;
  gap: 0.85rem;
  width: 100%;
  min-width: 0;
}

.ai-conversation-panel-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 0.6rem;
}

.ai-conversation-panel-header span {
  color: var(--synapse-color-text-muted);
  font-size: 0.65rem;
  font-weight: 750;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.ai-conversation-panel-header h2 {
  margin: 0.2rem 0 0;
  font-size: 1rem;
}

.ai-conversation-panel-actions {
  display: inline-flex;
  gap: 0.3rem;
}

.ai-conversation-panel button {
  font: inherit;
  cursor: pointer;
}

.ai-conversation-panel-header button {
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
  font-size: 0.78rem;
  font-weight: 700;
}

.ai-conversation-panel-header .ai-conversation-panel-close {
  width: 2rem;
  padding: 0;
  font-size: 1.15rem;
  line-height: 1;
}

.ai-conversation-panel-header button:hover:not(:disabled) {
  border-color: var(--synapse-color-accent);
  color: var(--synapse-color-accent-strong);
}

.ai-conversation-tabs {
  display: grid;
  gap: 0.3rem;
  max-height: min(65vh, 42rem);
  overflow: auto;
  scrollbar-width: thin;
}

.ai-conversation-tabs button {
  overflow: hidden;
  width: 100%;
  padding: 0.6rem 0.65rem;
  border: 1px solid transparent;
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: transparent;
  font-size: 0.85rem;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-conversation-tabs button:hover:not(:disabled),
.ai-conversation-tabs button.is-active {
  border-color: var(--synapse-color-border);
  background: var(--synapse-color-surface-accent);
}

.ai-conversation-tabs button.is-active {
  color: var(--synapse-color-accent-strong);
  font-weight: 700;
}

.ai-conversation-tabs button:focus-visible,
.ai-conversation-panel-header button:focus-visible {
  outline: 3px solid
    color-mix(in srgb, var(--synapse-color-accent) 24%, transparent);
  outline-offset: 1px;
}

.ai-conversation-empty {
  margin: 0;
  color: var(--synapse-color-text-muted);
  font-size: 0.82rem;
}
</style>
