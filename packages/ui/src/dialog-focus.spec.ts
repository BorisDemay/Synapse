import { describe, expect, it, vi } from "vitest";

import {
  DialogFocusController,
  getDialogFocusableElements,
} from "./dialog-focus";

function buildDialog() {
  const container = document.createElement("section");
  container.setAttribute("role", "dialog");
  container.innerHTML = `
    <button type="button" id="first">Premier</button>
    <input id="middle" />
    <button type="button" id="last" disabled>Désactivé</button>
    <button type="button" id="final">Dernier</button>
  `;
  document.body.append(container);
  return container;
}

describe("dialog-focus", () => {
  it("keeps programmatic focus changes inside the active modal", () => {
    const container = buildDialog();
    const outside = document.createElement("button");
    document.body.append(outside);
    const controller = new DialogFocusController({
      getContainer: () => container,
      onEscape: () => {},
    });
    controller.attach();
    outside.focus();
    expect(container.contains(document.activeElement)).toBe(true);
    controller.detach();
    container.remove();
    outside.remove();
  });

  it("excludes controls in hidden and inert ancestors", () => {
    const container = buildDialog();
    container.insertAdjacentHTML(
      "beforeend",
      '<div style="display:none"><button id="css-hidden">hidden</button></div><div inert><button id="inert">inert</button></div>',
    );
    expect(getDialogFocusableElements(container).map((el) => el.id)).toEqual([
      "first",
      "middle",
      "final",
    ]);
    container.remove();
  });
  it("liste les éléments focusables actifs dans l’ordre du DOM", () => {
    const container = buildDialog();

    const focusables = getDialogFocusableElements(container).map(
      (element) => element.id,
    );

    expect(focusables).toEqual(["first", "middle", "final"]);
    container.remove();
  });

  it("attache : déplace le focus dans le dialogue et mémorise l’élément d’origine", () => {
    const container = buildDialog();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const controller = new DialogFocusController({
      getContainer: () => container,
      onEscape: () => {},
    });
    controller.attach();

    expect(document.activeElement).toBe(container.querySelector("#first"));

    controller.detach();
    container.remove();
    opener.remove();
  });

  it("attache : Tab depuis le dernier élément revient au premier", () => {
    const container = buildDialog();
    const controller = new DialogFocusController({
      getContainer: () => container,
      onEscape: () => {},
    });
    controller.attach();
    container.querySelector<HTMLElement>("#final")?.focus();

    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );

    expect(document.activeElement).toBe(container.querySelector("#first"));

    controller.detach();
    container.remove();
  });

  it("attache : Maj+Tab depuis le premier élément revient au dernier", () => {
    const container = buildDialog();
    const controller = new DialogFocusController({
      getContainer: () => container,
      onEscape: () => {},
    });
    controller.attach();

    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      }),
    );

    expect(document.activeElement).toBe(container.querySelector("#final"));

    controller.detach();
    container.remove();
  });

  it("attache : Échappe appelle le rappel de fermeture", () => {
    const container = buildDialog();
    const onEscape = vi.fn();
    const controller = new DialogFocusController({
      getContainer: () => container,
      onEscape,
    });
    controller.attach();

    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(onEscape).toHaveBeenCalledTimes(1);

    controller.detach();
    container.remove();
  });

  it("détache : retire l’écouteur et rend le focus à l’élément d’origine", () => {
    const container = buildDialog();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const onEscape = vi.fn();
    const controller = new DialogFocusController({
      getContainer: () => container,
      onEscape,
    });
    controller.attach();
    expect(document.activeElement).not.toBe(opener);

    controller.detach();

    expect(document.activeElement).toBe(opener);
    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onEscape).not.toHaveBeenCalled();

    container.remove();
    opener.remove();
  });
});
