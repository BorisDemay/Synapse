import { createApp, h, withDirectives } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TOOLTIP_SHOW_DELAY_MS,
  hideTooltip,
  resetTooltip,
  showTooltip,
  synapseTooltip,
} from "./tooltip";

function tooltip(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="tooltip"]');
}

function createTrigger(
  attributes: Record<string, string> = {},
): HTMLButtonElement {
  const trigger = document.createElement("button");

  for (const [name, value] of Object.entries(attributes)) {
    trigger.setAttribute(name, value);
  }

  document.body.append(trigger);

  return trigger;
}

function mountDirectiveTrigger(label: string) {
  const container = document.createElement("div");

  document.body.append(container);

  const app = createApp({
    render: () =>
      withDirectives(h("button", { type: "button" }, "Enregistrer"), [
        [synapseTooltip, label],
      ]),
  });

  app.mount(container);

  return {
    trigger: container.querySelector("button") as HTMLButtonElement,
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}

describe("infobulle applicative", () => {
  beforeEach(() => {
    resetTooltip();
    document.body.replaceChildren();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetTooltip();
  });

  it("n'utilise qu'un seul élément pour toutes les infobulles", () => {
    const first = createTrigger();
    const second = createTrigger();

    showTooltip(first, "Première");
    showTooltip(second, "Seconde");

    const elements = document.querySelectorAll<HTMLElement>('[role="tooltip"]');

    expect(elements).toHaveLength(1);
    expect(elements[0].textContent).toBe("Seconde");
    expect(elements[0].hidden).toBe(false);
  });

  it("attache l'infobulle au document et la masque sur demande", () => {
    const trigger = createTrigger();

    showTooltip(trigger, "Enregistrer");

    expect(tooltip()?.isConnected).toBe(true);
    expect(tooltip()?.textContent).toBe("Enregistrer");

    hideTooltip(trigger);

    expect(tooltip()?.hidden).toBe(true);
    expect(tooltip()?.textContent).toBe("");
  });

  it("décrit le déclencheur seulement quand le texte enrichit son nom", () => {
    const named = createTrigger({ "aria-label": "Paramètres" });
    const labelled = createTrigger();
    const verbose = createTrigger({ "aria-label": "Paramètres" });

    labelled.append(document.createTextNode("Enregistrer"));

    showTooltip(named, "Paramètres");

    expect(named.hasAttribute("aria-describedby")).toBe(false);

    showTooltip(labelled, "Enregistrer");

    expect(labelled.hasAttribute("aria-describedby")).toBe(false);

    showTooltip(verbose, "Ouvrir les paramètres du coffre");

    expect(verbose.getAttribute("aria-describedby")).toBe(tooltip()?.id);
    expect(tooltip()?.id).toBeTruthy();

    hideTooltip(verbose);

    expect(verbose.hasAttribute("aria-describedby")).toBe(false);
  });

  it("place l'infobulle au-dessus puis en dessous selon la place disponible", () => {
    const trigger = createTrigger();

    trigger.getBoundingClientRect = () =>
      ({ top: 200, bottom: 220, left: 10 }) as DOMRect;

    showTooltip(trigger, "En haut");

    expect(tooltip()?.dataset.placement).toBe("top");

    trigger.getBoundingClientRect = () =>
      ({ top: 0, bottom: 20, left: 10 }) as DOMRect;

    showTooltip(trigger, "En bas");

    expect(tooltip()?.dataset.placement).toBe("bottom");
  });

  it("se masque dès qu'une interaction ou un défilement a lieu ailleurs", () => {
    const trigger = createTrigger();

    for (const type of ["pointerdown", "scroll", "keydown"] as const) {
      showTooltip(trigger, "Enregistrer");
      expect(tooltip()?.hidden).toBe(false);

      document.dispatchEvent(new Event(type, { bubbles: true }));

      expect(tooltip()?.hidden, `après ${type}`).toBe(true);
    }
  });

  it("ne masque pas l'infobulle d'un autre déclencheur", () => {
    const shown = createTrigger();
    const other = createTrigger();

    showTooltip(shown, "Enregistrer");
    hideTooltip(other);

    expect(tooltip()?.hidden).toBe(false);

    hideTooltip(shown);

    expect(tooltip()?.hidden).toBe(true);
  });

  it("ignore une étiquette vide", () => {
    const trigger = createTrigger();

    showTooltip(trigger, "   ");

    expect(tooltip()?.hidden ?? true).toBe(true);
  });

  it("affiche l'infobulle de la directive après un délai de survol", () => {
    const { trigger, unmount } = mountDirectiveTrigger("Ouvrir les paramètres");

    trigger.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS - 1);

    expect(tooltip()?.hidden ?? true).toBe(true);

    vi.advanceTimersByTime(1);

    expect(tooltip()?.hidden).toBe(false);
    expect(tooltip()?.textContent).toBe("Ouvrir les paramètres");

    unmount();
  });

  it("affiche l'infobulle de la directive immédiatement au focus", () => {
    const { trigger, unmount } = mountDirectiveTrigger("Ouvrir les paramètres");

    trigger.dispatchEvent(new Event("focus"));

    expect(tooltip()?.hidden).toBe(false);

    trigger.dispatchEvent(new Event("blur"));

    expect(tooltip()?.hidden).toBe(true);

    unmount();
  });

  it("masque l'infobulle de la directive au survol sortant et au clic", () => {
    const { trigger, unmount } = mountDirectiveTrigger("Enregistrer");

    trigger.dispatchEvent(new Event("focus"));
    trigger.dispatchEvent(new Event("pointerleave"));

    expect(tooltip()?.hidden).toBe(true);

    trigger.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS);

    expect(tooltip()?.hidden).toBe(false);

    trigger.dispatchEvent(new Event("pointerdown"));

    expect(tooltip()?.hidden).toBe(true);

    unmount();
  });

  it("retire l'infobulle et ses écouteurs à la destruction du déclencheur", () => {
    const { trigger, unmount } = mountDirectiveTrigger("Enregistrer");

    trigger.dispatchEvent(new Event("focus"));

    expect(tooltip()?.hidden).toBe(false);

    unmount();

    expect(tooltip()?.hidden).toBe(true);

    trigger.dispatchEvent(new Event("focus"));

    expect(tooltip()?.hidden).toBe(true);
  });
});
