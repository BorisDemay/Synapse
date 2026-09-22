import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import VaultTree from "../VaultTree.vue";

const nodes = [
  { id: "note-1", label: "Première note" },
  { id: "note-2", label: "Deuxième note" },
];

describe("VaultTree", () => {
  it("shows folder disclosure and visual nesting for full paths", () => {
    const wrapper = mount(VaultTree, {
      props: {
        nodes: [
          {
            id: "folder",
            kind: "folder",
            label: "Work",
            children: [{ id: "nested", kind: "note", label: "Overview" }],
          },
        ],
      },
    });
    expect(
      wrapper.get('[data-kind="folder"] .vault-tree-disclosure').text(),
    ).toBe("▾");
    expect(wrapper.get('[data-kind="note"]').attributes("style")).toContain(
      "--tree-depth: 1",
    );
    wrapper.unmount();
  });
  it("rend la première fenêtre de 10 000 feuilles hiérarchiques sans lire les branches hors écran", () => {
    const nestedNodes = Array.from({ length: 100 }, (_, folderIndex) => ({
      children: Array.from({ length: 100 }, (_, noteIndex) => ({
        id: `folder-${folderIndex}/note-${noteIndex}`,
        kind: "note" as const,
        label: `Note ${folderIndex}-${noteIndex}`,
      })),
      id: `folder:${folderIndex}`,
      kind: "folder" as const,
      label: `Dossier ${folderIndex}`,
    }));
    let offscreenBranchReads = 0;
    Object.defineProperty(nestedNodes[99], "id", {
      get() {
        offscreenBranchReads++;
        return "folder:99";
      },
    });
    const wrapper = mount(VaultTree, { props: { nodes: nestedNodes } });

    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(80);
    expect(offscreenBranchReads).toBe(1);
  });

  it("borne le nombre de lignes matérialisées pour un coffre de 10 000 notes", () => {
    const largeNodes = Array.from({ length: 10_000 }, (_, index) => ({
      id: `note-${index}`,
      label: `Note ${index}`,
    }));
    const wrapper = mount(VaultTree, { props: { nodes: largeNodes } });

    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(80);
  });

  it("sélectionne une feuille virtualisée sans lire les branches hors fenêtre", async () => {
    const nestedNodes = Array.from({ length: 100 }, (_, folderIndex) => ({
      children: Array.from({ length: 100 }, (_, noteIndex) => ({
        id: `folder-${folderIndex}/note-${noteIndex}`,
        kind: "note" as const,
        label: `Note ${folderIndex}-${noteIndex}`,
      })),
      id: `folder:${folderIndex}`,
      kind: "folder" as const,
      label: `Dossier ${folderIndex}`,
    }));
    let offscreenBranchReads = 0;
    const offscreenChildren = nestedNodes[99].children;
    Object.defineProperty(nestedNodes[99], "children", {
      get() {
        offscreenBranchReads++;
        return offscreenChildren;
      },
    });
    const wrapper = mount(VaultTree, { props: { nodes: nestedNodes } });

    offscreenBranchReads = 0;
    await wrapper.get('[data-tree-index="1"]').trigger("click");

    expect(
      wrapper.get('[data-tree-index="1"]').attributes("aria-selected"),
    ).toBe("true");
    expect(offscreenBranchReads).toBe(0);
  });

  it("replie un dossier sans matérialiser ses descendants", async () => {
    const wrapper = mount(VaultTree, {
      props: {
        nodes: [
          {
            children: [
              { id: "projets/alpha.md", kind: "note", label: "Alpha" },
              { id: "projets/beta.md", kind: "note", label: "Beta" },
            ],
            id: "folder:projets",
            kind: "folder",
            label: "projets",
          },
        ],
      },
    });
    const folder = wrapper.get('[data-kind="folder"]');

    expect(folder.attributes("aria-expanded")).toBe("true");
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(3);

    await folder.trigger("click");

    expect(folder.attributes("aria-expanded")).toBe("false");
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(1);
  });

  it("conserve la sélection d'une feuille lorsque les lignes précédentes sont repliées", async () => {
    const wrapper = mount(VaultTree, {
      props: {
        nodes: [
          {
            children: [
              { id: "a/one.md", kind: "note", label: "One" },
              { id: "a/two.md", kind: "note", label: "Two" },
            ],
            id: "folder:a",
            kind: "folder",
            label: "A",
          },
          {
            children: [{ id: "b/three.md", kind: "note", label: "Three" }],
            id: "folder:b",
            kind: "folder",
            label: "B",
          },
        ],
      },
    });

    await wrapper.get('[data-tree-index="4"]').trigger("click");
    await wrapper.get('[data-tree-index="0"]').trigger("click");

    const selected = wrapper.get('[data-tree-index="2"]');
    expect(selected.attributes("aria-selected")).toBe("true");
    expect(selected.attributes("tabindex")).toBe("0");
  });

  it("focalise une feuille hiérarchique hors de la fenêtre avec ArrowDown", async () => {
    const nestedNodes = Array.from({ length: 100 }, (_, folderIndex) => ({
      children: Array.from({ length: 100 }, (_, noteIndex) => ({
        id: `folder-${folderIndex}/note-${noteIndex}`,
        kind: "note" as const,
        label: `Note ${folderIndex}-${noteIndex}`,
      })),
      id: `folder:${folderIndex}`,
      kind: "folder" as const,
      label: `Dossier ${folderIndex}`,
    }));
    const wrapper = mount(VaultTree, {
      attachTo: document.body,
      props: { nodes: nestedNodes },
    });
    const tree = wrapper.get('[role="tree"]');

    (tree.element as HTMLElement).scrollTop = 1_000 * 56;
    await tree.trigger("scroll");
    const current = wrapper.get('[data-tree-index="1000"]');
    (current.element as HTMLElement).focus();
    await current.trigger("keydown", { key: "ArrowDown" });

    const selected = wrapper.get('[data-tree-index="1001"]');
    expect(wrapper.emitted("select")?.[0]).toEqual(["folder-9/note-91"]);
    expect(document.activeElement).toBe(selected.element);
    expect(selected.attributes("aria-level")).toBe("2");
    expect(selected.attributes("aria-posinset")).toBe("92");
    expect(selected.attributes("aria-setsize")).toBe("100");
  });

  it("préserve attach et delete sur les feuilles avec les attributs ARIA hiérarchiques", async () => {
    const wrapper = mount(VaultTree, {
      props: {
        nodes: [
          {
            children: [
              { id: "projets/roadmap.md", kind: "note", label: "Roadmap" },
              { id: "projets/image.png", kind: "attachment", label: "image" },
            ],
            id: "folder:projets",
            kind: "folder",
            label: "projets",
          },
        ],
      },
    });
    const folder = wrapper.get('[data-kind="folder"]');
    const note = wrapper.get('[data-tree-index="1"]');

    expect(folder.attributes("aria-level")).toBe("1");
    expect(folder.attributes("aria-posinset")).toBe("1");
    expect(folder.attributes("aria-setsize")).toBe("1");
    expect(folder.find('button[aria-label^="Supprimer"]').exists()).toBe(false);
    expect(note.attributes("aria-level")).toBe("2");
    expect(note.attributes("aria-posinset")).toBe("1");
    expect(note.attributes("aria-setsize")).toBe("2");

    await note.trigger("click", { ctrlKey: true });
    await note.get('button[aria-label="Supprimer Roadmap"]').trigger("click");

    expect(wrapper.emitted("attach")?.[0]).toEqual(["projets/roadmap.md"]);
    expect(wrapper.emitted("delete")?.[0]).toEqual(["projets/roadmap.md"]);
  });

  it("sélectionne et focalise une note virtualisée sans perdre sa commande de suppression", async () => {
    const largeNodes = Array.from({ length: 10_000 }, (_, index) => ({
      id: `note-${index}`,
      label: `Note ${index}`,
    }));
    const wrapper = mount(VaultTree, {
      attachTo: document.body,
      props: { nodes: largeNodes },
    });
    const tree = wrapper.get('[role="tree"]');

    (tree.element as HTMLElement).scrollTop = 500 * 56;
    await tree.trigger("scroll");

    const virtualizedItem = wrapper.get('[data-tree-index="500"]');
    (virtualizedItem.element as HTMLElement).focus();
    await virtualizedItem.trigger("keydown", { key: "ArrowDown" });

    const selectedItem = wrapper.get('[data-tree-index="501"]');
    expect(wrapper.emitted("select")?.[0]).toEqual(["note-501"]);
    expect(document.activeElement).toBe(selectedItem.element);
    expect(selectedItem.attributes("aria-selected")).toBe("true");
    expect(selectedItem.attributes("aria-posinset")).toBe("502");
    expect(selectedItem.attributes("aria-setsize")).toBe("10000");
    expect(
      selectedItem
        .get('button[aria-label="Supprimer Note 501"]')
        .attributes("aria-label"),
    ).toBe("Supprimer Note 501");
  });

  it("réinitialise la fenêtre après le remplacement d'un grand coffre", async () => {
    const largeNodes = Array.from({ length: 10_000 }, (_, index) => ({
      id: `note-${index}`,
      label: `Note ${index}`,
    }));
    const wrapper = mount(VaultTree, { props: { nodes: largeNodes } });
    const tree = wrapper.get('[role="tree"]');

    (tree.element as HTMLElement).scrollTop = 500 * 56;
    await tree.trigger("scroll");
    await wrapper.setProps({ nodes: largeNodes.slice(0, 100) });

    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(80);
  });

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

  it("suit la sélection externe (palette, récents, backlinks) sans clic dans l'arbre", async () => {
    const wrapper = mount(VaultTree, { props: { nodes, selectedId: null } });

    await wrapper.setProps({ selectedId: "note-2" });

    const items = wrapper.findAll('[role="treeitem"]');
    expect(items[1]!.attributes("aria-selected")).toBe("true");
    expect(items[1]!.attributes("tabindex")).toBe("0");
    expect(items[0]!.attributes("aria-selected")).toBe("false");
  });

  it("déplie les dossiers parents pour révéler la note sélectionnée depuis l'extérieur", async () => {
    const wrapper = mount(VaultTree, {
      props: {
        nodes: [
          {
            children: [
              { id: "projets/alpha.md", kind: "note", label: "Alpha" },
            ],
            id: "folder:projets",
            kind: "folder",
            label: "projets",
          },
        ],
        selectedId: null,
      },
    });

    await wrapper.get('[data-kind="folder"]').trigger("click");
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(1);

    await wrapper.setProps({ selectedId: "projets/alpha.md" });

    expect(
      wrapper.get('[data-kind="folder"]').attributes("aria-expanded"),
    ).toBe("true");
    expect(wrapper.get('[data-kind="note"]').attributes("aria-selected")).toBe(
      "true",
    );
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

  it("n'affiche ni icône ni pastille de sync sur les lignes", () => {
    const wrapper = mount(VaultTree, {
      props: {
        nodes: [
          {
            id: "note-1",
            kind: "note",
            label: "Première note",
            syncStatus: "synced",
          },
          {
            id: "att-1",
            kind: "attachment",
            label: "image.png",
            syncStatus: "pending",
          },
        ],
      },
    });

    expect(wrapper.find(".vault-tree-icon").exists()).toBe(false);
    expect(wrapper.find(".vault-tree-sync").exists()).toBe(false);
  });

  it("affiche les dossiers et masque la poubelle des dossiers", async () => {
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
    expect(wrapper.find(".vault-tree-sync").exists()).toBe(false);
    expect(
      wrapper.findAll(
        '[data-kind="folder"] > .vault-tree-row button[aria-label^="Supprimer"]',
      ),
    ).toHaveLength(0);

    await wrapper.get('[data-kind="folder"]').trigger("click");
    expect(wrapper.find('[data-kind="note"]').exists()).toBe(false);
  });
});
