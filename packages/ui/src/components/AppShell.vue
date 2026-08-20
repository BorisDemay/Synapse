<template>
  <div class="app-shell">
    <aside class="app-shell-sidebar" aria-label="Navigation du coffre">
      <slot name="navigation" />
    </aside>
    <main class="app-shell-content">
      <slot />
    </main>
    <aside
      v-if="$slots.relations"
      class="app-shell-relations"
      aria-label="Relations de la note"
    >
      <slot name="relations" />
    </aside>
    <aside
      v-if="$slots.assistantHistory"
      class="app-shell-assistant-history"
      aria-label="Conversations Codex"
    >
      <slot name="assistantHistory" />
    </aside>
    <aside
      v-if="$slots.assistant"
      class="app-shell-assistant"
      aria-label="Assistant d'écriture"
    >
      <slot name="assistant" />
    </aside>
  </div>
</template>
