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

  it("lie une note à l'assistant avec Control+clic sans changer la sélection", async () => {
    const wrapper = mount(VaultTree, {
      props: { attachedIds: ["note-2"], nodes },
    });

    await wrapper
      .findAll('[role="treeitem"]')[1]
      .trigger("click", { ctrlKey: true });

    expect(wrapper.emitted("attach")?.[0]).toEqual(["note-2"]);
    expect(wrapper.emitted("select")).toBeUndefined();
    expect(
      wrapper.findAll('[role="treeitem"]')[1].attributes("data-attached"),
    ).toBe("true");
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

    expect(wrapper.get('[role="status"]').text()).toContain(
      "Votre coffre est vide",
    );
  });

  it("expose une poubelle nommée sur chaque note", () => {
    const wrapper = mount(VaultTree, { props: { nodes } });

    expect(
      wrapper
        .findAll('[role="treeitem"]')
        .map((item) =>
          item.get('button[aria-label^="Supprimer"]').attributes("aria-label"),
        ),
    ).toEqual(["Supprimer Première note", "Supprimer Deuxième note"]);
  });

  it("supprime une note au clic sur la poubelle sans changer la sélection", async () => {
    const wrapper = mount(VaultTree, { props: { nodes } });

    await wrapper
      .findAll('[role="treeitem"]')[1]
      .get('button[aria-label="Supprimer Deuxième note"]')
      .trigger("click");

    expect(wrapper.emitted("delete")?.[0]).toEqual(["note-2"]);
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("supprime la note focalisée avec la touche Delete", async () => {
    const wrapper = mount(VaultTree, { props: { nodes } });

    await wrapper
      .get('[role="treeitem"]')
      .trigger("keydown", { key: "Delete" });

    expect(wrapper.emitted("delete")?.[0]).toEqual(["note-1"]);
  });

  it("affiche les dossiers, les pastilles de sync et masque la poubelle des dossiers", async () => {
    const wrapper = mount(VaultTree, {
      props: {
        nodes: [
          {
            children: [
              {
                id: "projets/roadmap.md",
                kind: "note",
                label: "Roadmap",
                syncStatus: "pending",
              },
            ],
            id: "folder:projets",
            kind: "folder",
            label: "projets",
          },
        ],
      },
    });

    expect(wrapper.get('[data-kind="folder"]').text()).toContain("projets");
    expect(wrapper.get('[data-status="pending"]').exists()).toBe(true);
    expect(
      wrapper
        .get('[data-kind="folder"]')
        .find(":scope > .vault-tree-row button[aria-label^='Supprimer']")
        .exists(),
    ).toBe(false);

    await wrapper.get('[data-kind="folder"]').trigger("click");
    expect(wrapper.find('[data-kind="note"]').exists()).toBe(false);
  });
});
