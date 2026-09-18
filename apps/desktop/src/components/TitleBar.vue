<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onMounted, ref } from "vue";

const maximized = ref(false);

async function currentWindow() {
  return getCurrentWindow();
}

async function refreshMaximized() {
  try {
    maximized.value = await currentWindow().then((window) =>
      window.isMaximized(),
    );
  } catch {
    maximized.value = false;
  }
}

async function minimize() {
  await currentWindow().then((window) => window.minimize());
}

async function toggleMaximize() {
  await currentWindow().then((window) => window.toggleMaximize());
  await refreshMaximized();
}

async function closeWindow() {
  await currentWindow().then((window) => window.close());
}

onMounted(() => {
  void refreshMaximized();
});
</script>

<template>
  <header class="titlebar" data-tauri-drag-region>
    <div class="titlebar-brand">
      <span class="titlebar-mark" aria-hidden="true">S</span>
      <span>Synapse</span>
    </div>
    <div class="titlebar-controls">
      <button type="button" aria-label="Réduire" @click="minimize">
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <rect
            x="2"
            y="5.25"
            width="8"
            height="1.5"
            rx="0.4"
            fill="currentColor"
          />
        </svg>
      </button>
      <button
        type="button"
        :aria-label="maximized ? 'Restaurer' : 'Agrandir'"
        @click="toggleMaximize"
      >
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <rect
            x="2.5"
            y="2.5"
            width="7"
            height="7"
            rx="0.6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
          />
        </svg>
      </button>
      <button
        class="titlebar-close"
        type="button"
        aria-label="Fermer"
        @click="closeWindow"
      >
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path
            d="M3 3 L9 9 M9 3 L3 9"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  height: 2.4rem;
  padding: 0 0.35rem 0 0.85rem;
  color: var(--synapse-color-text);
  background: color-mix(
    in srgb,
    var(--synapse-color-surface-raised) 88%,
    var(--synapse-color-surface)
  );
  border-bottom: 1px solid var(--synapse-color-border);
  user-select: none;
  -webkit-app-region: drag;
  app-region: drag;
}

.titlebar-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  pointer-events: none;
}

.titlebar-mark {
  display: grid;
  place-items: center;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 0.4rem;
  color: #fff;
  background: var(--synapse-color-accent);
  font-size: 0.7rem;
}

.titlebar-controls {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.titlebar-controls button {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 100%;
  border: 0;
  color: var(--synapse-color-text-muted);
  background: transparent;
  cursor: pointer;
}

.titlebar-controls button:hover,
.titlebar-controls button:focus-visible {
  color: var(--synapse-color-text);
  background: color-mix(in srgb, var(--synapse-color-text) 8%, transparent);
  outline: none;
}

.titlebar-close:hover,
.titlebar-close:focus-visible {
  color: #fff;
  background: var(--synapse-color-danger);
}
</style>
