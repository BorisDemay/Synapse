import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import VaultExplorerToolbar from "../VaultExplorerToolbar.vue";
import { resetTooltip, synapseTooltip } from "../../tooltip";

const tooltipDirective = { directives: { "synapse-tooltip": synapseTooltip } };

afterEach(() => {
  resetTooltip();
});

describe("VaultExplorerToolbar", () => {
  it("garde les actions en icône accessibles sans infobulle native", () => {
    const wrapper = mount(VaultExplorerToolbar, {
      props: {
        showImport: true,
        showImportFolder: true,
        showTemplate: true,
      },
      global: tooltipDirective,
    });

    for (const label of [
      "Créer depuis un modèle",
      "Importer un ZIP Markdown (.zip)",
      "Importer un dossier Markdown",
      "Masquer la barre latérale",
    ]) {
      expect(
        wrapper.get(`[aria-label="${label}"]`).attributes("title"),
        `${label} ne doit plus compter sur l'infobulle native`,
      ).toBeUndefined();
    }
  });

  it("affiche l'infobulle applicative au focus", async () => {
    const wrapper = mount(VaultExplorerToolbar, {
      props: {
        showImport: true,
        showImportFolder: true,
        showTemplate: true,
      },
      global: tooltipDirective,
    });
    const trigger = wrapper.get('[aria-label="Créer depuis un modèle"]');

    await trigger.trigger("focus");

    const tooltip = document.querySelector<HTMLElement>("#synapse-tooltip");

    expect(tooltip?.hidden).toBe(false);
    expect(tooltip?.textContent).toBe("Créer depuis un modèle");
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
      wrapper.find('[aria-label="Afficher la barre latérale"]').exists(),
    ).toBe(true);
  });
});
