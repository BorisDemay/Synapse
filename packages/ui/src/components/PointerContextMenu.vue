<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import type { MarkdownMenuItem } from "../markdown/editor-tools";
import MarkdownMenuPanel from "./MarkdownMenuPanel.vue";

/** Orchestrateur générique de menu contextuel ancré au pointeur : placement
 * clampé, sous-menu latéral, fermeture au mousedown extérieur / Échap /
 * resize, et restitution du focus à l'élément actif avant ouverture quand la
 * fermeture vient d'Échap. Réutilisé par l'éditeur Markdown et par l'arbre du
 * coffre. */
const props = defineProps<{
  items: readonly MarkdownMenuItem[];
  label: string;
  open: boolean;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  close: [];
  select: [id: string];
}>();

const rootPanel = ref<InstanceType<typeof MarkdownMenuPanel>>();
const submenuPanel = ref<InstanceType<typeof MarkdownMenuPanel>>();
const left = ref(0);
const top = ref(0);
const openSubmenuId = ref<string>();
const submenuAnchor = ref<HTMLElement>();
const submenuLeft = ref(0);
const submenuTop = ref(0);
const previouslyFocused = ref<HTMLElement>();

const margin = 8;

const openSubmenu = computed(() =>
  props.items.find(
    (item): item is Extract<MarkdownMenuItem, { type: "submenu" }> =>
      item.type === "submenu" && item.id === openSubmenuId.value,
  ),
);

function rememberFocusedElement() {
  previouslyFocused.value =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
}

/** Rend le focus à l'élément actif avant ouverture : Échap doit remonter au
 * point de départ (ligne de l'arbre, éditeur) et non laisser le focus perdu. */
function restorePreviousFocus() {
  const element = previouslyFocused.value;
  previouslyFocused.value = undefined;
  if (element && element.isConnected) {
    element.focus({ preventScroll: true });
  }
}

function closeAll() {
  openSubmenuId.value = undefined;
  submenuAnchor.value = undefined;
  emit("close");
}

async function placeRoot() {
  await nextTick();
  const node = rootPanel.value?.rootEl;
  if (!node) {
    return;
  }
  left.value = Math.max(
    margin,
    Math.min(props.x, window.innerWidth - node.offsetWidth - margin),
  );
  top.value = Math.max(
    margin,
    Math.min(props.y, window.innerHeight - node.offsetHeight - margin),
  );
}

async function placeSubmenu(anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  // Position beside the parent item immediately; refine once the panel has
  // been measured on the next tick.
  submenuLeft.value = rect.right + 4;
  submenuTop.value = rect.top;
  await nextTick();
  const node = submenuPanel.value?.rootEl;
  if (!node) {
    return;
  }
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  let nextLeft = rect.right + 4;
  if (nextLeft + width > window.innerWidth - margin) {
    nextLeft = rect.left - width - 4;
  }
  submenuLeft.value = Math.max(
    margin,
    Math.min(nextLeft, window.innerWidth - width - margin),
  );
  submenuTop.value = Math.max(
    margin,
    Math.min(rect.top, window.innerHeight - height - margin),
  );
}

function onOpenSubmenu(id: string, anchor: HTMLElement) {
  openSubmenuId.value = id;
  submenuAnchor.value = anchor;
  void placeSubmenu(anchor);
}

function closeSubmenu() {
  openSubmenuId.value = undefined;
  const anchor = submenuAnchor.value;
  submenuAnchor.value = undefined;
  anchor?.focus({ preventScroll: true });
}

function onRootSelect(id: string) {
  emit("select", id);
  closeAll();
}

function onSubmenuSelect(id: string) {
  emit("select", id);
  closeAll();
}

function onRootHoverCommand() {
  if (openSubmenuId.value) {
    closeSubmenu();
  }
}

function onRootEscape() {
  restorePreviousFocus();
  closeAll();
}

function onSubmenuEscape() {
  closeSubmenu();
}

function onDocumentPointerDown(event: Event) {
  const target = event.target as Node;
  if (
    !rootPanel.value?.rootEl?.contains(target) &&
    !submenuPanel.value?.rootEl?.contains(target)
  ) {
    closeAll();
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    if (openSubmenuId.value) {
      closeSubmenu();
    } else {
      restorePreviousFocus();
      closeAll();
    }
  }
}

function onViewportChange() {
  // The menu is anchored to the pointer position in the viewport, not to a
  // moving element, so scrolling content underneath is harmless; only a
  // viewport resize can push the clamped position off-screen.
  closeAll();
}

function bindDismissListeners() {
  document.addEventListener("mousedown", onDocumentPointerDown, true);
  window.addEventListener("keydown", onDocumentKeydown);
  window.addEventListener("resize", onViewportChange);
}

function unbindDismissListeners() {
  document.removeEventListener("mousedown", onDocumentPointerDown, true);
  window.removeEventListener("keydown", onDocumentKeydown);
  window.removeEventListener("resize", onViewportChange);
}

watch(
  () => [props.open, props.x, props.y, props.items] as const,
  async ([open]) => {
    unbindDismissListeners();
    openSubmenuId.value = undefined;
    submenuAnchor.value = undefined;
    if (!open) {
      return;
    }
    left.value = props.x;
    top.value = props.y;
    rememberFocusedElement();
    bindDismissListeners();
    await placeRoot();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  unbindDismissListeners();
});
</script>

<template>
  <!-- Rendu sur place, sans Teleport (ADR 0019) : les panneaux sont en
       `position: fixed` et ancrés au pointeur, donc le menu se place au niveau
       des autres overlays de la vue — jamais dans la barre latérale, dont le
       `backdrop-filter` crée un bloc conteneur pour `position: fixed`. -->
  <MarkdownMenuPanel
    v-if="open"
    ref="rootPanel"
    :items="items"
    :label="label"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @close="onRootEscape"
    @hover-command="onRootHoverCommand"
    @open-submenu="onOpenSubmenu"
    @select="onRootSelect"
  />
  <MarkdownMenuPanel
    v-if="open && openSubmenu"
    :key="openSubmenu.id"
    ref="submenuPanel"
    is-submenu
    :items="openSubmenu.items"
    :label="openSubmenu.label"
    :style="{
      left: `${submenuLeft}px`,
      top: `${submenuTop}px`,
    }"
    @close="onSubmenuEscape"
    @open-submenu="onOpenSubmenu"
    @select="onSubmenuSelect"
  />
</template>
