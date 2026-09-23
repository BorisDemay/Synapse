import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  overlayStackDepth,
  overlayStackLabels,
  overlayZIndex,
  pushOverlay,
  resetOverlayStack,
} from "./overlay-stack";

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });

  document.dispatchEvent(event);

  return event;
}

describe("pile d'overlays", () => {
  beforeEach(() => {
    resetOverlayStack();
    document.body.removeAttribute("style");
  });

  it("attribue une profondeur croissante dans l'ordre d'ouverture", () => {
    const first = pushOverlay();
    const second = pushOverlay();
    const third = pushOverlay();

    expect([first.depth, second.depth, third.depth]).toEqual([0, 1, 2]);
    expect(second.zIndex).toBe("calc(var(--synapse-z-overlay) + 1)");
    expect(overlayStackDepth()).toBe(3);
  });

  it("recalcule les profondeurs quand un overlay du milieu se ferme", () => {
    const first = pushOverlay({ label: "premier" });
    const middle = pushOverlay({ label: "milieu" });
    const last = pushOverlay({ label: "dernier" });

    middle.release();

    expect([first.depth, last.depth]).toEqual([0, 1]);
    expect(overlayStackDepth()).toBe(2);
    expect(overlayStackLabels()).toEqual(["premier", "dernier"]);
  });

  it("ne libère qu'une fois un overlay déjà libéré", () => {
    const first = pushOverlay();
    const second = pushOverlay();

    first.release();
    first.release();

    expect(overlayStackDepth()).toBe(1);
    expect(second.depth).toBe(0);
  });

  it("route Échap vers le seul overlay du dessus", () => {
    const below = vi.fn();
    const above = vi.fn();

    pushOverlay({ onEscape: below, label: "en dessous" });
    pushOverlay({ onEscape: above, label: "au dessus" });

    const event = pressEscape();

    expect(above).toHaveBeenCalledTimes(1);
    expect(below).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("consomme Échap même quand l'overlay du dessus ne le gère pas", () => {
    pushOverlay({ onEscape: vi.fn(), label: "en dessous" });
    pushOverlay({ label: "au dessus" });

    const event = pressEscape();

    expect(event.defaultPrevented).toBe(true);
  });

  it("n'écoute le clavier que pendant qu'un overlay est ouvert", () => {
    const listener = vi.fn();

    document.addEventListener("keydown", listener);

    pressEscape();

    const handle = pushOverlay();

    pressEscape();
    handle.release();
    pressEscape();

    document.removeEventListener("keydown", listener);

    // Deux Échap atteignent l'écouteur tiers (pile vide), celui du milieu est
    // consommé par l'overlay ouvert.
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("retire son écouteur dès que la pile se vide", () => {
    const onEscape = vi.fn();
    const handle = pushOverlay({ onEscape });

    handle.release();
    pressEscape();

    expect(onEscape).not.toHaveBeenCalled();
    expect(overlayStackDepth()).toBe(0);
  });

  it("verrouille le défilement tant qu'un overlay le demande", () => {
    document.body.style.overflow = "auto";

    const modal = pushOverlay({ lockScroll: true });
    const other = pushOverlay({ lockScroll: true });

    expect(document.body.style.overflow).toBe("hidden");

    modal.release();

    expect(document.body.style.overflow).toBe("hidden");

    other.release();

    expect(document.body.style.overflow).toBe("auto");
  });

  it("ne verrouille pas le défilement par défaut", () => {
    const handle = pushOverlay();

    expect(document.body.style.overflow).toBe("");

    handle.release();
  });

  it("libère tout sur resetOverlayStack", () => {
    pushOverlay({ lockScroll: true, onEscape: vi.fn() });

    resetOverlayStack();

    expect(overlayStackDepth()).toBe(0);
    expect(document.body.style.overflow).toBe("");
  });

  it("formate une profondeur en valeur d'empilement", () => {
    expect(overlayZIndex(0)).toBe("calc(var(--synapse-z-overlay) + 0)");
    expect(overlayZIndex(7)).toBe("calc(var(--synapse-z-overlay) + 7)");
  });
});
