<script setup lang="ts">
import { ref } from "vue";
import { dismissToast, notify, toasts, type Toast } from "./toasts";

const busy = ref<number | null>(null);
async function runAction(toast: Toast) {
  if (!toast.action || busy.value === toast.id) return;
  busy.value = toast.id;
  try {
    await toast.action.run();
    dismissToast(toast.id);
  } catch {
    dismissToast(toast.id);
    notify({ kind: "error", message: "Action impossible. Réessayez." });
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div class="toast-stack toast-stack--top-right" aria-label="Notifications">
    <slot />
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="toast"
      :data-kind="toast.kind"
      :role="toast.kind === 'error' ? 'alert' : 'status'"
    >
      <div class="toast-body">
        <span class="toast-kind">{{
          {
            info: "Information",
            success: "Succès",
            warning: "Attention",
            error: "Erreur",
          }[toast.kind]
        }}</span>
        <span class="toast-message">{{ toast.message }}</span>
        <button
          v-if="toast.action"
          class="toast-action"
          type="button"
          :disabled="busy === toast.id"
          @click="runAction(toast)"
        >
          {{ toast.action.label }}
        </button>
      </div>
      <button
        class="toast-dismiss"
        type="button"
        aria-label="Fermer la notification"
        @click="dismissToast(toast.id)"
      >
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  inset-block-start: max(1rem, env(safe-area-inset-top));
  inset-inline-end: max(1rem, env(safe-area-inset-right));
  z-index: 1100;
  display: grid;
  gap: 0.6rem;
  width: min(24rem, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  overflow-y: auto;
  pointer-events: none;
}
.toast {
  --toast-accent: #60a5fa;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  padding: 0.8rem 0.9rem;
  border: 1px solid var(--toast-accent);
  border-inline-start: 0.3rem solid var(--toast-accent);
  border-radius: 0.6rem;
  background: var(--synapse-color-surface-raised, #172033);
  box-shadow: 0 12px 30px rgb(0 0 0 / 35%);
  color: var(--synapse-color-text, #f8fafc);
  pointer-events: auto;
}
.toast[data-kind="success"] {
  --toast-accent: #34d399;
}
.toast[data-kind="warning"] {
  --toast-accent: #fbbf24;
}
.toast[data-kind="error"] {
  --toast-accent: #fb7185;
}
.toast-body {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
  overflow-wrap: anywhere;
}
.toast-kind {
  color: var(--toast-accent);
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
}
.toast-action {
  width: fit-content;
  margin-block-start: 0.25rem;
  color: var(--synapse-color-text, #f8fafc);
  font-weight: 700;
  text-decoration: underline;
}
.toast button {
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
}
.toast button:disabled {
  cursor: wait;
  opacity: 0.6;
}
.toast button:focus-visible {
  outline: 2px solid var(--toast-accent);
  outline-offset: 2px;
}
.toast-dismiss {
  align-self: start;
  color: var(--synapse-color-text, #f8fafc);
  font-size: 1.25rem !important;
}
</style>
