import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { markdownContextMenuGroups } from "../../markdown/editor-tools";
import MarkdownContextMenu from "../MarkdownContextMenu.vue";

function menuNode() {
  return document.body.querySelector<HTMLElement>('[role="menu"]');
}

function menuItems() {
  return [
    ...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ];
}

describe("MarkdownContextMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists the editor tools in an accessible menu", async () => {
    mount(MarkdownContextMenu, {
      attachTo: document.body,
      props: {
        groups: markdownContextMenuGroups({ inTable: false }),
        open: true,
        x: 24,
        y: 48,
      },
    });

    const menu = menuNode();
    expect(menu?.getAttribute("aria-label")).toBe("Outils Markdown");
    const labels = menuItems().map((item) => item.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(["Gras", "Lien", "Émojis"]));
    expect(labels).not.toContain("Texte brut");
    expect(labels).not.toContain("Titre 1");
    expect(labels).not.toContain("Insérer une ligne en dessous");
  });

  it("emits the selected command and closes on Escape", async () => {
    const wrapper = mount(MarkdownContextMenu, {
      attachTo: document.body,
      props: {
        groups: markdownContextMenuGroups({ inTable: false }),
        open: true,
        x: 16,
        y: 16,
      },
    });

    menuItems()[0]?.click();
    expect(wrapper.emitted("select")?.[0]).toEqual(["bold"]);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("moves between items with the arrow keys and activates with Enter", async () => {
    const wrapper = mount(MarkdownContextMenu, {
      attachTo: document.body,
      props: {
        groups: markdownContextMenuGroups({ inTable: false }),
        open: true,
        x: 16,
        y: 16,
      },
    });

    const menu = menuNode();
    menu?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    menu?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(wrapper.emitted("select")?.[0]).toEqual(["italic"]);
  });

  it("closes on a pointer down outside the menu", async () => {
    const wrapper = mount(MarkdownContextMenu, {
      attachTo: document.body,
      props: {
        groups: markdownContextMenuGroups({ inTable: true }),
        open: true,
        x: 16,
        y: 16,
      },
    });

    expect(menuItems().map((item) => item.textContent?.trim())).toEqual(
      expect.arrayContaining(["Gras", "Insérer une ligne en dessous"]),
    );

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("stays open while the page or the menu itself scrolls", async () => {
    const wrapper = mount(MarkdownContextMenu, {
      attachTo: document.body,
      props: {
        groups: markdownContextMenuGroups({ inTable: false }),
        open: true,
        x: 16,
        y: 16,
      },
    });

    // Scrolling inside the menu (it has overflow: auto)…
    menuNode()?.dispatchEvent(new Event("scroll", { bubbles: true }));
    // …and scrolling any page-level container must not dismiss it.
    window.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")).toBeFalsy();
  });
});
