import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import VaultExplorerToolbar from "../VaultExplorerToolbar.vue";

describe("VaultExplorerToolbar", () => {
  it("renders icon-only vault actions with accessible labels", () => {
    const wrapper = mount(VaultExplorerToolbar, {
      props: {
        showImport: true,
        showImportFolder: true,
        showTemplate: true,
      },
    });

    expect(
      wrapper.get('[aria-label="Créer depuis un modèle"]').attributes("title"),
    ).toBe("Créer depuis un modèle");
    expect(
      wrapper
        .get('[aria-label="Importer un ZIP Markdown (.zip)"]')
        .attributes("title"),
    ).toBe("Importer un ZIP Markdown (.zip)");
    expect(
      wrapper
        .get('[aria-label="Importer un dossier Markdown"]')
        .attributes("title"),
    ).toBe("Importer un dossier Markdown");
    expect(
      wrapper
        .get('[aria-label="Masquer la barre latérale"]')
        .attributes("title"),
    ).toBe("Masquer la barre latérale");
  });

  it("emits actions when toolbar icons are clicked", async () => {
    const wrapper = mount(VaultExplorerToolbar, {
      props: {
        showImport: true,
        showImportFolder: true,
        showTemplate: true,
      },
    });

    await wrapper
      .get('[aria-label="Importer un ZIP Markdown (.zip)"]')
      .trigger("click");
    await wrapper
      .get('[aria-label="Masquer la barre latérale"]')
      .trigger("click");

    expect(wrapper.emitted("import")).toHaveLength(1);
    expect(wrapper.emitted("toggle-sidebar")).toHaveLength(1);
  });

  it("empile les icônes verticalement en mode mini-rail", () => {
    const wrapper = mount(VaultExplorerToolbar, {
      props: {
        showImport: true,
        showImportFolder: true,
        showTemplate: true,
        sidebarCollapsed: true,
      },
    });

    expect(wrapper.classes()).toContain("vault-explorer-toolbar--collapsed");
    expect(
      wrapper
        .get('[aria-label="Afficher la barre latérale"]')
        .attributes("title"),
    ).toBe("Afficher la barre latérale");
  });
});
