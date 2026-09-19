import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";

import {
  PANEL_WIDTH_BOUNDS,
  PANEL_WIDTH_STORAGE_KEY,
  resetPanelLayoutState,
} from "../../panel-resize";
import AppShell from "../AppShell.vue";

const tokensCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../styles/tokens.css"),
  "utf8",
);

describe("AppShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetPanelLayoutState();
  });

  it("expose une zone principale pour le contenu de la note", () => {
    const wrapper = mount(AppShell, {
      slots: {
        navigation: "<nav>Navigation</nav>",
        default: "<article>Note active</article>",
      },
    });

    expect(wrapper.get("main").text()).toBe("Note active");
    expect(wrapper.get("aside").text()).toBe("Navigation");
  });

  it("expose un rail de relations optionnel", () => {
    const wrapper = mount(AppShell, {
      slots: {
        default: "<article>Note active</article>",
        navigation: "<nav>Navigation</nav>",
        relations: "<p>Liens</p>",
      },
    });

    expect(wrapper.get('[aria-label="Relations de la note"]').text()).toBe(
      "Liens",
    );
  });

  it("expose un panneau d'assistant optionnel", () => {
    const wrapper = mount(AppShell, {
      slots: {
        assistant: "<p>Chat Codex</p>",
        default: "<article>Note active</article>",
        navigation: "<nav>Navigation</nav>",
      },
    });

    expect(wrapper.get('[aria-label="Assistant d\'écriture"]').text()).toBe(
      "Chat Codex",
    );
  });

  it("expose un panneau de conversations indépendant de l'assistant", () => {
    const wrapper = mount(AppShell, {
      slots: {
        assistant: "<p>Chat Codex</p>",
        assistantHistory: "<p>Fils Codex</p>",
        default: "<article>Note active</article>",
        navigation: "<nav>Navigation</nav>",
      },
    });

    expect(
      wrapper.get('[aria-label="Conversations de l’assistant"]').text(),
    ).toBe("Fils Codex");
  });

  it("réduit la barre latérale en mini-rail quand sidebarCollapsed est actif", () => {
    const wrapper = mount(AppShell, {
      props: {
        sidebarCollapsed: true,
      },
      slots: {
        default: "<article>Note active</article>",
        navigation: "<nav>Navigation</nav>",
      },
    });

    expect(wrapper.classes()).toContain("app-shell--sidebar-collapsed");
    const sidebar = wrapper.get(
      '[aria-label="Navigation du coffre (mini-rail)"]',
    );
    expect(sidebar.attributes("aria-hidden")).toBeUndefined();
    expect(sidebar.attributes("inert")).toBeUndefined();
    expect(sidebar.text()).toBe("Navigation");
  });

  it("anime la colonne latérale vers 3rem via la variable CSS quand sidebarCollapsed est actif", () => {
    const wrapper = mount(AppShell, {
      props: {
        sidebarCollapsed: true,
      },
      slots: {
        default: "<article>Note active</article>",
        navigation: "<nav>Navigation</nav>",
      },
    });

    expect(wrapper.classes()).toContain("app-shell--sidebar-collapsed");
    expect(tokensCss).toContain("--app-shell-sidebar-width-collapsed: 3rem");
    expect(tokensCss).toMatch(
      /\.app-shell--sidebar-collapsed[\s\S]*--app-shell-sidebar-width:\s*var\(--app-shell-sidebar-width-collapsed\)/,
    );
  });

  it("réserve la largeur complète à l'assistant sous 75rem", () => {
    expect(tokensCss).toContain("@media (max-width: 75rem)");
    expect(tokensCss).toMatch(
      /@media \(max-width: 75rem\)[\s\S]*grid-template-columns:\s*var\(--app-shell-sidebar-width\)\s*minmax\(0,\s*1fr\)\s*minmax\(\s*0,\s*1fr\s*\)/,
    );
    expect(tokensCss).toMatch(
      /@media \(min-width: 75\.01rem\)[\s\S]*min-width:\s*71rem/,
    );
  });

  it("n'affiche pas de bouton de réouverture dans l'éditeur", () => {
    const wrapper = mount(AppShell, {
      props: {
        sidebarCollapsed: true,
      },
      slots: {
        default: "<article>Note active</article>",
        navigation: "<nav>Navigation</nav>",
      },
    });

    expect(wrapper.find(".app-shell-sidebar-reopen").exists()).toBe(false);
    expect(wrapper.find("main").text()).toBe("Note active");
  });

  it("expose quatre poignées de redimensionnement quand tous les panneaux sont présents", () => {
    const wrapper = mount(AppShell, {
      slots: {
        assistant: "<p>Chat Codex</p>",
        assistantHistory: "<p>Fils Codex</p>",
        default: "<article>Note active</article>",
        navigation: "<nav>Navigation</nav>",
        relations: "<p>Liens</p>",
      },
    });

    const separators = wrapper.findAll('[role="separator"]');
    expect(separators).toHaveLength(4);
    expect(
      wrapper.get('[aria-label="Redimensionner la navigation"]').attributes(),
    ).toMatchObject({
      "aria-controls": "app-shell-sidebar",
      "aria-orientation": "vertical",
    });
    expect(
      wrapper
        .get('[aria-label="Redimensionner les relations"]')
        .attributes("aria-controls"),
    ).toBe("app-shell-relations");
    expect(
      wrapper
        .get('[aria-label="Redimensionner les conversations"]')
        .attributes("aria-controls"),
    ).toBe("app-shell-assistant-history");
    expect(
      wrapper
        .get('[aria-label="Redimensionner l\'assistant"]')
        .attributes("aria-controls"),
    ).toBe("app-shell-assistant");
  });

  it("n'affiche pas la poignée de navigation si la barre latérale est repliée", () => {
    const wrapper = mount(AppShell, {
      props: {
        sidebarCollapsed: true,
      },
      slots: {
        default: "<article>Note active</article>",
        navigation: "<nav>Navigation</nav>",
      },
    });

    expect(
      wrapper.find('[aria-label="Redimensionner la navigation"]').exists(),
    ).toBe(false);
    expect(wrapper.findAll('[role="separator"]')).toHaveLength(0);
  });

  it("élargit la navigation avec ArrowRight sur la poignée", async () => {
    const wrapper = mount(AppShell, {
      slots: {
        default: "<article>Note active</article>",
        navigation: "<nav>Navigation</nav>",
      },
    });

    await wrapper
      .get('[aria-label="Redimensionner la navigation"]')
      .trigger("keydown", { key: "ArrowRight" });

    const shell = wrapper.get(".app-shell").element as HTMLElement;
    expect(
      shell.style.getPropertyValue("--app-shell-sidebar-width-expanded"),
    ).toBe(`${PANEL_WIDTH_BOUNDS.sidebar.default + 8}px`);
  });

  it("persiste la largeur dans localStorage après un redimensionnement clavier", async () => {
    const wrapper = mount(AppShell, {
      slots: {
        default: "<article>Note active</article>",
        navigation: "<nav>Navigation</nav>",
      },
    });

    await wrapper
      .get('[aria-label="Redimensionner la navigation"]')
      .trigger("keydown", { key: "ArrowRight" });

    expect(
      JSON.parse(window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY) ?? "{}"),
    ).toMatchObject({
      sidebar: PANEL_WIDTH_BOUNDS.sidebar.default + 8,
    });
  });

  it("cache les poignées sous 48rem et relie les colonnes aux variables CSS", () => {
    expect(tokensCss).toContain("--app-shell-relations-width");
    expect(tokensCss).toContain("--app-shell-assistant-history-width");
    expect(tokensCss).toContain("--app-shell-assistant-width");
    expect(tokensCss).toMatch(
      /@media \(max-width: 48rem\)[\s\S]*\.app-shell-resize-handle[\s\S]*display:\s*none/,
    );
    expect(tokensCss).toMatch(
      /width:\s*min\(\s*var\(--app-shell-relations-width\),\s*100%\s*\)/,
    );
  });
});
