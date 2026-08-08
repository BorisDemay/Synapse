import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import VaultTree from "../VaultTree.vue";

const nodes = [
  { id: "note-1", label: "Première note" },
  { id: "note-2", label: "Deuxième note" },
];

describe("VaultTree", () => {
  it("expose les notes dans un arbre ARIA nommé", () => {
    const wrapper = mount(VaultTree, { props: { nodes } });

    expect(wrapper.get('[role="tree"]').attributes("aria-label")).toBe(
      "Notes du coffre",
    );
  });

  it("n'expose qu'une note à la tabulation", () => {
    const wrapper = mount(VaultTree, { props: { nodes } });

    expect(
      wrapper
        .findAll('[role="treeitem"]')
        .map((item) => item.attributes("tabindex")),
    ).toEqual(["0", "-1"]);
  });

  it("sélectionne la note suivante avec ArrowDown", async () => {
    const wrapper = mount(VaultTree, { props: { nodes } });

    await wrapper
      .get('[role="treeitem"]')
      .trigger("keydown", { key: "ArrowDown" });

    expect(wrapper.emitted("select")?.[0]).toEqual(["note-2"]);
  });

  it("déplace le focus vers la note suivante avec ArrowDown", async () => {
    const wrapper = mount(VaultTree, {
      attachTo: document.body,
      props: { nodes },
    });
    const items = wrapper.findAll('[role="treeitem"]');

    (items[0].element as HTMLElement).focus();
    await items[0].trigger("keydown", { key: "ArrowDown" });

    expect(document.activeElement).toBe(items[1].element);
  });

  it("sélectionne une note avec la souris", async () => {
    const wrapper = mount(VaultTree, { props: { nodes } });

    await wrapper.findAll('[role="treeitem"]')[1].trigger("click");

    expect(wrapper.emitted("select")?.[0]).toEqual(["note-2"]);
  });

  it("expose la note sélectionnée aux technologies d'assistance", async () => {
    const wrapper = mount(VaultTree, { props: { nodes } });

    await wrapper.findAll('[role="treeitem"]')[1].trigger("click");

    expect(
      wrapper.findAll('[role="treeitem"]')[1].attributes("aria-selected"),
    ).toBe("true");
  });

  it("annonce un coffre vide", () => {
    const wrapper = mount(VaultTree, { props: { nodes: [] } });

    expect(wrapper.get('[role="status"]').text()).toBe(
      "Aucune note dans ce coffre.",
    );
  });
});
