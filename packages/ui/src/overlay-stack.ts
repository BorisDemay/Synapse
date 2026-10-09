import { computed, reactive, ref, type Ref } from "vue";

/**
 * Pile d'overlays de l'interface.
 *
 * Tous les overlays applicatifs (palette de recherche, panneau de réglages,
 * menus contextuels, aperçus de pièce jointe) s'enregistrent ici. La pile
 * possède trois responsabilités qui étaient auparavant dispersées :
 *
 * 1. l'empilement : la profondeur est dérivée de l'ordre d'ouverture, donc
 *    deux overlays ne peuvent plus partager la même valeur d'empilement. Elle
 *    est injectée dans `--synapse-z-*` via
 *    `z-index: calc(var(--synapse-z-overlay) + depth)` ;
 * 2. Échap : un seul écouteur de document, qui ne l'envoie qu'à l'overlay du
 *    dessus. Sans cela, chaque overlay écoute le clavier et un seul Échap les
 *    ferme tous ;
 * 3. le verrou de défilement : compté par référence, pour que la fermeture d'un
 *    overlay imbriqué ne libère pas le défilement des autres.
 *
 * Ce module ne gère ni le focus ni le piège de tabulation : voir
 * `DialogFocusController` dans `dialog-focus.ts`.
 */

export interface OverlayOptions {
  /** Appelé sur Échap lorsque cet overlay est le plus haut de la pile. */
  onEscape?: () => void;
  /** Bloque le défilement du document tant que cet overlay est ouvert. */
  lockScroll?: boolean;
  /** Nom lisible, utilisé par les tests et le débogage. */
  label?: string;
}

export interface OverlayHandle {
  /** Profondeur courante, recalculée quand un overlay plus bas se ferme. */
  readonly depth: number;
  /** Valeur prête à lier à un `z-index`. */
  readonly zIndex: string;
  release(): void;
}

interface OverlayEntry {
  readonly label: string;
  readonly onEscape?: () => void;
  readonly lockScroll: boolean;
  readonly depth: Ref<number>;
  released: boolean;
}

const entries: OverlayEntry[] = [];

let scrollLocks = 0;
let bodyOverflowBeforeLock: string | null = null;
let listeningToKeyboard = false;

/** Empilement d'un overlay de profondeur `depth`, dans la bande applicative. */
export function overlayZIndex(depth: number): string {
  return `calc(var(--synapse-z-overlay) + ${depth})`;
}

function syncDepths(): void {
  entries.forEach((entry, index) => {
    entry.depth.value = index;
  });
}

function clearScrollLock(): void {
  scrollLocks = 0;

  if (bodyOverflowBeforeLock !== null) {
    document.body.style.overflow = bodyOverflowBeforeLock;
    bodyOverflowBeforeLock = null;
  } else {
    document.body.style.removeProperty("overflow");
  }
}

function acquireScrollLock(): void {
  if (scrollLocks === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }

  scrollLocks += 1;
}

function releaseScrollLock(): void {
  if (scrollLocks === 0) {
    return;
  }

  scrollLocks -= 1;

  if (scrollLocks === 0) {
    clearScrollLock();
  }
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") {
    return;
  }

  const top = entries[entries.length - 1];

  if (!top) {
    return;
  }

  // Échap appartient à l'overlay du dessus : les overlays plus bas, et le reste
  // de l'application, ne doivent pas le voir.
  event.preventDefault();
  event.stopImmediatePropagation();
  top.onEscape?.();
}

function attachKeyboardListener(): void {
  if (listeningToKeyboard) {
    return;
  }

  document.addEventListener("keydown", handleDocumentKeydown, true);
  listeningToKeyboard = true;
}

function detachKeyboardListener(): void {
  if (!listeningToKeyboard) {
    return;
  }

  document.removeEventListener("keydown", handleDocumentKeydown, true);
  listeningToKeyboard = false;
}

function releaseEntry(entry: OverlayEntry): void {
  if (entry.released) {
    return;
  }

  entry.released = true;

  const index = entries.indexOf(entry);

  if (index === -1) {
    return;
  }

  entries.splice(index, 1);
  syncDepths();

  if (entry.lockScroll) {
    releaseScrollLock();
  }

  if (entries.length === 0) {
    detachKeyboardListener();
  }
}

/**
 * Enregistre un overlay. À appeler quand il devient visible, et à libérer avec
 * `release()` (typiquement dans un `watch` ou un `onUnmounted`).
 */
export function pushOverlay(options: OverlayOptions = {}): OverlayHandle {
  const entry: OverlayEntry = {
    depth: ref(entries.length),
    label: options.label ?? "overlay",
    lockScroll: options.lockScroll ?? false,
    onEscape: options.onEscape,
    released: false,
  };

  entries.push(entry);
  attachKeyboardListener();

  if (entry.lockScroll) {
    acquireScrollLock();
  }

  return reactive({
    depth: entry.depth,
    zIndex: computed(() => overlayZIndex(entry.depth.value)),
    release: () => releaseEntry(entry),
  });
}

/** Nombre d'overlays actuellement ouverts. */
export function overlayStackDepth(): number {
  return entries.length;
}

/** Libellés empilés du plus bas au plus haut, pour le débogage et les tests. */
export function overlayStackLabels(): string[] {
  return entries.map((entry) => entry.label);
}

/** Ferme tous les overlays et remet le module dans son état initial. */
export function resetOverlayStack(): void {
  for (const entry of [...entries]) {
    entry.released = true;
  }

  entries.length = 0;
  clearScrollLock();
  detachKeyboardListener();
}
