import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { markdownContextMenuItems } from "../../markdown/editor-tools";
import MarkdownContextMenu from "../MarkdownContextMenu.vue";

function rootNode() {
  return document.body.querySelector<HTMLElement>(
    '[role="menu"][aria-label="Outils Markdown"]',
  );
}

function submenuNode(label: string) {
  return document.body.querySelector<HTMLElement>(
    `[role="menu"][aria-label="${label}"]`,
  );
}

function items(scope: ParentNode) {
  return [...scope.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}

function itemLabel(item: HTMLButtonElement) {
  return (
    item
      .querySelector<HTMLSpanElement>(".synapse-markdown-context-item-label")
      ?.textContent?.trim() ?? ""
  );
}

function mountMenu(
  props: Partial<{
    headingLevel: number;
    inTable: boolean;
    selectionEmpty: boolean;
  }> = {},
) {
  return mount(MarkdownContextMenu, {
    attachTo: document.body,
    props: {
      items: markdownContextMenuItems({
        headingLevel: props.headingLevel ?? 0,
        inTable: props.inTable ?? false,
        selectionEmpty: props.selectionEmpty ?? false,
      }),
      open: true,
      x: 24,
      y: 48,
    },
  });
}

describe("MarkdownContextMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the reference root menu with icons and submenu chevrons", () => {
    mountMenu();

    const root = rootNode();
    expect(root?.getAttribute("aria-label")).toBe("Outils Markdown");
    const labels = items(root!).map((item) => itemLabel(item));
    expect(labels).toEqual([
      "Annuler",
      "Rétablir",
      "Ajouter un lien",
      "Ajouter un lien externe",
      "Formater",
      "Paragraphe",
      "Insérer",
      "Émojis",
      "Mode d’édition",
      "Couper",
      "Copier",
      "Coller",
      "Coller en texte brut",
      "Tout sélectionner",
    ]);
    expect(
      root?.querySelectorAll(".synapse-markdown-context-item-icon"),
    ).toHaveLength(items(root!).length);
    expect(
      root?.querySelectorAll(".synapse-markdown-context-item-chevron"),
    ).toHaveLength(5);
    expect(
      items(root!).filter(
        (item) => item.getAttribute("aria-haspopup") === "true",
      ),
    ).toHaveLength(5);
    expect(submenuNode("Formater")).toBeNull();
  });

  it("shows the shortcut hint apart from the accessible command name", () => {
    mountMenu();

    const root = rootNode()!;
    const addLink = items(root).find(
      (item) => itemLabel(item) === "Ajouter un lien",
    )!;
    expect(itemLabel(addLink)).toBe("Ajouter un lien");
    expect(addLink.textContent?.trim()).toContain("Ctrl+Shift+K");
    const hint = addLink.querySelector<HTMLSpanElement>(
      ".synapse-markdown-context-item-shortcut",
    );
    expect(hint?.getAttribute("aria-hidden")).toBe("true");
    expect(
      items(root)
        .find((item) => itemLabel(item) === "Annuler")
        ?.querySelector(".synapse-markdown-context-item-shortcut"),
    ).toBeNull();
  });

  it("emits the selected command and closes on Escape", async () => {
    const wrapper = mountMenu();

    items(rootNode()!)
      .find((item) => itemLabel(item) === "Ajouter un lien")
      ?.click();
    expect(wrapper.emitted("select")?.[0]).toEqual(["add-link"]);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("moves between items with the arrow keys and activates with Enter", async () => {
    const wrapper = mountMenu();
    const root = rootNode()!;

    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(wrapper.emitted("select")?.[0]).toEqual(["redo"]);
  });

  it("opens a submenu on hover and selects a command from it", async () => {
    const wrapper = mountMenu();

    items(rootNode()!)
      .find((item) => item.textContent?.trim() === "Formater")
      ?.dispatchEvent(new Event("pointerenter", { bubbles: true }));
    await wrapper.vm.$nextTick();

    const formater = submenuNode("Formater");
    expect(formater).not.toBeNull();
    expect(items(formater!).map((item) => item.textContent?.trim())).toEqual([
      "Gras",
      "Italique",
      "Barré",
      "Code",
      "Mathématiques",
      "Commentaire",
      "Supprimer le formatage",
    ]);

    items(formater!)
      .find((item) => item.textContent?.trim() === "Italique")
      ?.click();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("select")?.[0]).toEqual(["italic"]);
    expect(wrapper.emitted("close")).toBeTruthy();
    await wrapper.setProps({ open: false });
    await wrapper.vm.$nextTick();
    expect(submenuNode("Formater")).toBeNull();
    expect(rootNode()).toBeNull();
  });

  it("marks the active paragraph style with a check", () => {
    mountMenu({ headingLevel: 2 });

    const paragraph = items(rootNode()!)
      .find((item) => itemLabel(item) === "Paragraphe")
      ?.textContent?.trim();
    expect(paragraph).toBe("Paragraphe");
  });

  it("closes only the submenu on Escape while it is open", async () => {
    const wrapper = mountMenu();

    items(rootNode()!)
      .find((item) => item.textContent?.trim() === "Paragraphe")
      ?.dispatchEvent(new Event("pointerenter", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(submenuNode("Paragraphe")).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(submenuNode("Paragraphe")).toBeNull();
    expect(rootNode()).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")?.length).toBeGreaterThan(0);
    await wrapper.setProps({ open: false });
    await wrapper.vm.$nextTick();
    expect(rootNode()).toBeNull();
  });

  it("renders disabled clipboard commands without selecting them", async () => {
    const wrapper = mountMenu({ selectionEmpty: true });

    const root = rootNode()!;
    const disabled = items(root).filter(
      (item) => item.getAttribute("aria-disabled") === "true",
    );
    expect(disabled.map((item) => item.textContent?.trim())).toEqual([
      "Couper",
      "Copier",
    ]);

    disabled[0]?.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("closes on a pointer down outside the menu", async () => {
    const wrapper = mountMenu({ inTable: true });

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("stays open while the page or the menu itself scrolls", async () => {
    const wrapper = mountMenu();

    rootNode()?.dispatchEvent(new Event("scroll", { bubbles: true }));
    window.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")).toBeFalsy();
  });
});
