import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import PointerContextMenu from "../PointerContextMenu.vue";
import type { MarkdownMenuItem } from "../../markdown/editor-tools";

const items: readonly MarkdownMenuItem[] = [
  { type: "item", id: "pin", label: "Épingler", checked: true },
  { type: "separator" },
  { type: "item", id: "export-pdf", label: "Exporter en PDF" },
  {
    type: "submenu",
    id: "plus",
    label: "Plus d'actions",
    items: [
      { type: "item", id: "duplicate", label: "Dupliquer la note" },
      { type: "item", id: "delete", label: "Supprimer", destructive: true },
    ],
  },
];

function rootNode() {
  return document.body.querySelector<HTMLElement>(
    '[role="menu"][aria-label="Actions de la note"]',
  );
}

function submenuNode() {
  return document.body.querySelector<HTMLElement>(
    '[role="menu"][aria-label="Plus d\'actions"]',
  );
}

function itemsIn(scope: ParentNode) {
  return [...scope.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}

function mountMenu(open = true, x = 24, y = 48) {
  return mount(PointerContextMenu, {
    attachTo: document.body,
    props: { items, label: "Actions de la note", open, x, y },
  });
}

describe("PointerContextMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("s'ouvre aux coordonnées clampées à 8 px des bords de la fenêtre", async () => {
    const wrapper = mountMenu(
      true,
      window.innerWidth + 500,
      window.innerHeight + 500,
    );
    await wrapper.vm.$nextTick();

    const root = rootNode()!;
    const left = Number.parseFloat(root.style.left);
    const top = Number.parseFloat(root.style.top);
    expect(left).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(top).toBeLessThanOrEqual(window.innerHeight - 8);
    expect(top).toBeGreaterThanOrEqual(8);
    wrapper.unmount();
  });

  it("émet l'identifiant de la commande et se referme après sélection", async () => {
    const wrapper = mountMenu();

    itemsIn(rootNode()!)
      .find((item) => item.textContent?.trim() === "Exporter en PDF")
      ?.click();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("select")?.[0]).toEqual(["export-pdf"]);
    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });

  it("ne surligne que la ligne survolée après un séparateur", async () => {
    const wrapper = mountMenu();
    await wrapper.vm.$nextTick();

    const root = rootNode()!;
    const plus = itemsIn(root).find(
      (item) => item.textContent?.trim() === "Plus d'actions",
    )!;
    const exportPdf = itemsIn(root).find(
      (item) => item.textContent?.trim() === "Exporter en PDF",
    )!;

    plus.dispatchEvent(new Event("pointerenter", { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(
      plus.classList.contains("synapse-markdown-context-item--active"),
    ).toBe(true);
    expect(
      exportPdf.classList.contains("synapse-markdown-context-item--active"),
    ).toBe(false);
    expect(
      itemsIn(root).filter((item) =>
        item.classList.contains("synapse-markdown-context-item--active"),
      ),
    ).toHaveLength(1);
    wrapper.unmount();
  });

  it("se referme à Échap", async () => {
    const wrapper = mountMenu();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });

  it("ne referme que le sous-menu à la première Échap", async () => {
    const wrapper = mountMenu();

    itemsIn(rootNode()!)
      .find((item) => item.textContent?.trim() === "Plus d'actions")
      ?.dispatchEvent(new Event("pointerenter", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(submenuNode()).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(submenuNode()).toBeNull();
    expect(rootNode()).not.toBeNull();
    expect(wrapper.emitted("close")).toBeFalsy();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });

  it("se referme au mousedown extérieur", async () => {
    const wrapper = mountMenu();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });

  it("place le sous-menu à gauche quand il n'a pas la place à droite", async () => {
    const wrapper = mountMenu(true, 24, 48);
    await wrapper.vm.$nextTick();

    const anchor = itemsIn(rootNode()!).find(
      (item) => item.textContent?.trim() === "Plus d'actions",
    )!;
    // On force un ancrage près du bord droit pour pousser le sous-menu à gauche.
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      x: window.innerWidth - 30,
      y: 48,
      top: 48,
      left: window.innerWidth - 30,
      right: window.innerWidth - 10,
      bottom: 76,
      width: 20,
      height: 28,
      toJSON: () => ({}),
    } as DOMRect);

    anchor.dispatchEvent(new Event("pointerenter", { bubbles: true }));
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const submenu = submenuNode()!;
    const left = Number.parseFloat(submenu.style.left);
    expect(left).toBeLessThan(window.innerWidth - 10);
    wrapper.unmount();
  });

  it("restitue le focus à l'élément actif avant ouverture quand on ferme à Échap", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Ligne de l'arbre";
    document.body.append(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const wrapper = mountMenu();
    // Laisse le panneau terminer son autofocus de montée avant l'Échap.
    await wrapper.vm.$nextTick();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();

    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
    trigger.remove();
  });

  it("ne rend rien quand il est fermé", () => {
    const wrapper = mountMenu(false);

    expect(rootNode()).toBeNull();
    wrapper.unmount();
  });
});
