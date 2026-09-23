import type { Directive } from "vue";

/**
 * Infobulle applicative.
 *
 * Remplaçait l'attribut HTML `title`, que le navigateur dessine hors de l'arbre
 * d'empilement de la page : une infobulle native restait affichée au-dessus d'un
 * menu qui venait de s'ouvrir, et ne suivait ni le thème, ni le défilement.
 *
 * L'infobulle est ici un élément unique, réutilisé, ajouté au `<body>` et
 * empilé par `--synapse-z-tooltip`. Elle se masque dès qu'une autre interaction
 * commence (appui, défilement, touche, redimensionnement, perte de focus).
 */

/** Délai de survol avant affichage, aligné sur l'usage courant des infobulles. */
export const TOOLTIP_SHOW_DELAY_MS = 400;

const TOOLTIP_ELEMENT_ID = "synapse-tooltip";

/** Hauteur approximative de l'infobulle, utilisée pour choisir son côté. */
const FLIP_MIN_SPACE_PX = 48;

let tooltipElement: HTMLDivElement | null = null;
let describedTrigger: HTMLElement | null = null;
let currentTrigger: HTMLElement | null = null;
let listeningForDismiss = false;

interface TooltipBindingState {
  label: string;
  teardown: () => void;
}

const bindings = new WeakMap<HTMLElement, TooltipBindingState>();

function ensureElement(): HTMLDivElement {
  if (tooltipElement?.isConnected) {
    return tooltipElement;
  }

  const element = document.createElement("div");

  element.id = TOOLTIP_ELEMENT_ID;
  element.className = "synapse-tooltip";
  element.setAttribute("role", "tooltip");
  element.hidden = true;
  document.body.append(element);
  tooltipElement = element;

  return element;
}

/**
 * Nom accessible du déclencheur. `aria-label` prime, sinon le texte visible.
 */
function accessibleName(trigger: HTMLElement): string {
  const label = trigger.getAttribute("aria-label") ?? trigger.textContent ?? "";

  return label.trim();
}

function place(
  element: HTMLDivElement,
  trigger: HTMLElement,
): "top" | "bottom" {
  const rect = trigger.getBoundingClientRect();
  const above = rect.top > FLIP_MIN_SPACE_PX;

  element.style.left = `${rect.left + rect.width / 2}px`;
  element.style.top = `${above ? rect.top : rect.bottom}px`;
  element.dataset.placement = above ? "top" : "bottom";

  return above ? "top" : "bottom";
}

function handleDismiss(): void {
  hideTooltip();
}

function attachDismissListeners(): void {
  if (listeningForDismiss) {
    return;
  }

  document.addEventListener("pointerdown", handleDismiss, true);
  document.addEventListener("keydown", handleDismiss, true);
  document.addEventListener("scroll", handleDismiss, true);
  window.addEventListener("resize", handleDismiss);
  window.addEventListener("blur", handleDismiss);
  listeningForDismiss = true;
}

function detachDismissListeners(): void {
  if (!listeningForDismiss) {
    return;
  }

  document.removeEventListener("pointerdown", handleDismiss, true);
  document.removeEventListener("keydown", handleDismiss, true);
  document.removeEventListener("scroll", handleDismiss, true);
  window.removeEventListener("resize", handleDismiss);
  window.removeEventListener("blur", handleDismiss);
  listeningForDismiss = false;
}

/** Affiche l'infobulle d'un déclencheur, en réutilisant l'élément unique. */
export function showTooltip(trigger: HTMLElement, label: string): void {
  const text = label.trim();

  if (!text) {
    hideTooltip(trigger);
    return;
  }

  const element = ensureElement();

  if (describedTrigger && describedTrigger !== trigger) {
    describedTrigger.removeAttribute("aria-describedby");
  }

  describedTrigger = null;
  element.textContent = text;
  element.hidden = false;
  place(element, trigger);

  // Ne décrire le déclencheur que si l'infobulle apporte une information de plus
  // que son nom accessible : sinon un lecteur d'écran l'annonce deux fois.
  if (accessibleName(trigger) !== text) {
    trigger.setAttribute("aria-describedby", element.id);
    describedTrigger = trigger;
  }

  currentTrigger = trigger;
  attachDismissListeners();
}

/**
 * Masque l'infobulle. Avec un déclencheur, ne masque que la sienne : un
 * `pointerleave` tardif ne doit pas fermer l'infobulle d'un autre contrôle.
 */
export function hideTooltip(trigger?: HTMLElement): void {
  if (trigger && currentTrigger !== trigger) {
    return;
  }

  if (describedTrigger) {
    describedTrigger.removeAttribute("aria-describedby");
    describedTrigger = null;
  }

  currentTrigger = null;

  if (tooltipElement) {
    tooltipElement.hidden = true;
    tooltipElement.textContent = "";
    delete tooltipElement.dataset.placement;
  }

  detachDismissListeners();
}

/** Retire l'infobulle du document : réservé aux tests et à la déconnexion. */
export function resetTooltip(): void {
  hideTooltip();
  detachDismissListeners();
  tooltipElement?.remove();
  tooltipElement = null;
}

function readLabel(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function bind(el: HTMLElement, state: TooltipBindingState): () => void {
  let timer: number | undefined;

  const clear = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };

  const showLater = () => {
    clear();
    timer = window.setTimeout(() => {
      timer = undefined;
      showTooltip(el, state.label);
    }, TOOLTIP_SHOW_DELAY_MS);
  };

  const showNow = () => {
    clear();
    showTooltip(el, state.label);
  };

  const hide = () => {
    clear();
    hideTooltip(el);
  };

  el.addEventListener("pointerenter", showLater);
  el.addEventListener("pointerleave", hide);
  el.addEventListener("focus", showNow);
  el.addEventListener("blur", hide);
  el.addEventListener("pointerdown", hide);

  return () => {
    clear();
    hide();
    el.removeEventListener("pointerenter", showLater);
    el.removeEventListener("pointerleave", hide);
    el.removeEventListener("focus", showNow);
    el.removeEventListener("blur", hide);
    el.removeEventListener("pointerdown", hide);
  };
}

/**
 * Directive `v-synapse-tooltip`, enregistrée par `installSynapseUi`. Elle
 * n'ajoute aucun élément autour du déclencheur, contrairement à un composant
 * englobant qui perturberait les barres d'outils.
 */
export const synapseTooltip: Directive<HTMLElement, string> = {
  mounted(el, binding) {
    const state: TooltipBindingState = {
      label: readLabel(binding.value),
      teardown: () => {},
    };

    state.teardown = bind(el, state);
    bindings.set(el, state);
  },

  updated(el, binding) {
    const state = bindings.get(el);

    if (state) {
      state.label = readLabel(binding.value);
    }
  },

  beforeUnmount(el) {
    const state = bindings.get(el);

    if (!state) {
      return;
    }

    state.teardown();
    bindings.delete(el);
  },
};

declare module "vue" {
  interface GlobalDirectives {
    VSynapseTooltip: typeof synapseTooltip;
  }
}
