import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PANEL_WIDTH_BOUNDS,
  PANEL_WIDTH_STORAGE_KEY,
  resetPanelLayoutState,
} from "../../panel-resize";
import { resetCompactNavigationLayoutState } from "../../app-shell-layout";
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

  it("réserve la largeur principale aux outils superposés sous 75rem", () => {
    expect(tokensCss).toContain("@media (max-width: 75rem)");
    expect(tokensCss).toMatch(
      /@media \(max-width: 75rem\)[\s\S]*\.app-shell > \.app-shell-assistant[\s\S]*position:\s*fixed/,
    );
    expect(tokensCss).not.toMatch(/min-width:\s*(71|84)rem/);
  });

  it("n'ajoute pas de défilement horizontal au shell", () => {
    expect(tokensCss).not.toContain("overflow-x");
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

describe("AppShell navigation drawer (compact)", () => {
  const compactQuery = "(max-width: 48rem)";

  function mockMatchMedia(matches: boolean) {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mql = {
      matches,
      media: compactQuery,
      addEventListener: vi.fn(
        (_: "change", listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener);
        },
      ),
      removeEventListener: vi.fn(
        (_: "change", listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
      ),
    };
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mql),
    );
    return mql;
  }

  let wrapper: VueWrapper | null = null;

  function mountCompactShell() {
    wrapper = mount(AppShell, {
      attachTo: document.body,
      slots: {
        navigation:
          '<nav><button type="button">Premier</button><button type="button">Dernier</button></nav>',
        default: "<article>Note active</article>",
      },
    });
    return wrapper;
  }

  beforeEach(() => {
    window.localStorage.clear();
    resetPanelLayoutState();
    resetCompactNavigationLayoutState();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.unstubAllGlobals();
  });

  it("garde le tiroir de navigation fermé par défaut sur écran compact", () => {
    mockMatchMedia(true);
    const wrapper = mountCompactShell();

    const shell = wrapper.get(".app-shell");
    expect(shell.classes()).toContain("app-shell--navigation-drawer");
    expect(shell.classes()).not.toContain("app-shell--navigation-drawer-open");

    const toggle = wrapper.get(".app-shell-nav-toggle");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(toggle.attributes("aria-controls")).toBe("app-shell-sidebar");

    const sidebar = wrapper.get('[aria-label^="Navigation du coffre"]');
    expect(sidebar.attributes("inert")).toBeDefined();
    expect(wrapper.find(".app-shell-backdrop").exists()).toBe(false);
  });

  it("ouvre le tiroir avec le bouton compact, place le backdrop et l'inertie, et déplace le focus", async () => {
    mockMatchMedia(true);
    const wrapper = mountCompactShell();

    await wrapper.get(".app-shell-nav-toggle").trigger("click");

    const shell = wrapper.get(".app-shell");
    expect(shell.classes()).toContain("app-shell--navigation-drawer-open");
    expect(
      wrapper.get(".app-shell-nav-toggle").attributes("aria-expanded"),
    ).toBe("true");
    expect(wrapper.find(".app-shell-backdrop").exists()).toBe(true);

    const sidebar = wrapper.get('[aria-label^="Navigation du coffre"]');
    expect(sidebar.attributes("inert")).toBeUndefined();
    expect(wrapper.get("main").attributes("inert")).toBeDefined();
    expect(document.activeElement).toBe(sidebar.element);
  });

  it("ferme le tiroir avec Échap et restaure le focus sur le bouton", async () => {
    mockMatchMedia(true);
    const wrapper = mountCompactShell();
    const toggle = wrapper.get(".app-shell-nav-toggle");
    (toggle.element as HTMLElement).focus();

    await toggle.trigger("click");
    expect(wrapper.find(".app-shell-backdrop").exists()).toBe(true);

    await wrapper
      .get('[aria-label^="Navigation du coffre"]')
      .trigger("keydown", { key: "Escape" });

    expect(wrapper.get(".app-shell").classes()).not.toContain(
      "app-shell--navigation-drawer-open",
    );
    expect(wrapper.find(".app-shell-backdrop").exists()).toBe(false);
    expect(wrapper.get("main").attributes("inert")).toBeUndefined();
    expect(document.activeElement).toBe(toggle.element);
  });

  it("interrompt la tabulation dans le tiroir ouvert", async () => {
    mockMatchMedia(true);
    const wrapper = mountCompactShell();

    await wrapper.get(".app-shell-nav-toggle").trigger("click");

    const sidebar = wrapper.get('[aria-label^="Navigation du coffre"]');
    const focusables = sidebar.findAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThanOrEqual(2);

    (focusables[focusables.length - 1]!.element as HTMLElement).focus();
    await sidebar.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]!.element);

    (focusables[0]!.element as HTMLElement).focus();
    await sidebar.trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(
      focusables[focusables.length - 1]!.element,
    );
  });

  it("ferme le tiroir au clic sur le backdrop", async () => {
    mockMatchMedia(true);
    const wrapper = mountCompactShell();

    await wrapper.get(".app-shell-nav-toggle").trigger("click");
    expect(wrapper.find(".app-shell-backdrop").exists()).toBe(true);

    await wrapper.get(".app-shell-backdrop").trigger("click");

    expect(wrapper.get(".app-shell").classes()).not.toContain(
      "app-shell--navigation-drawer-open",
    );
    expect(wrapper.find(".app-shell-backdrop").exists()).toBe(false);
  });

  it("referme le tiroir via closeNavigation() exposé à la vue workspace", async () => {
    mockMatchMedia(true);
    const wrapper = mountCompactShell();

    await wrapper.get(".app-shell-nav-toggle").trigger("click");
    expect(wrapper.get(".app-shell").classes()).toContain(
      "app-shell--navigation-drawer-open",
    );

    const exposed = wrapper.vm as { closeNavigation?: () => void };
    expect(typeof exposed.closeNavigation).toBe("function");
    exposed.closeNavigation?.();
    await wrapper.vm.$nextTick();

    expect(wrapper.get(".app-shell").classes()).not.toContain(
      "app-shell--navigation-drawer-open",
    );
    expect(wrapper.get("main").attributes("inert")).toBeUndefined();
  });

  it("reste un volet en grille sur grand écran, sans tiroir ni bouton visible", () => {
    const wrapper = mountCompactShell();

    const shell = wrapper.get(".app-shell");
    expect(shell.classes()).not.toContain("app-shell--navigation-drawer");
    const sidebar = wrapper.get('[aria-label^="Navigation du coffre"]');
    expect(sidebar.attributes("inert")).toBeUndefined();
    expect(wrapper.get("main").attributes("inert")).toBeUndefined();
    expect(wrapper.find(".app-shell-backdrop").exists()).toBe(false);
    expect(wrapper.find(".app-shell-nav-toggle").exists()).toBe(true);
  });

  it("décrit le tiroir compact et le bouton dans les tokens CSS", () => {
    expect(tokensCss).toMatch(
      /@media \(max-width: 48rem\)[\s\S]*\.app-shell > aside\.app-shell-sidebar[\s\S]*position:\s*fixed/,
    );
    expect(tokensCss).toMatch(
      /@media \(max-width: 48rem\)[\s\S]*\.app-shell-backdrop[\s\S]*position:\s*fixed/,
    );
    expect(tokensCss).toMatch(
      /\.app-shell-nav-toggle\s*\{[^}]*display:\s*none/,
    );
    expect(tokensCss).toMatch(
      /@media \(max-width: 48rem\)[\s\S]*\.app-shell-nav-toggle[\s\S]*display:\s*inline-flex/,
    );
  });

  it("superpose les outils secondaires au lieu de les empiler sous 48rem", () => {
    expect(tokensCss).not.toMatch(/position:\s*static/);
    const wideCompactBlock =
      tokensCss.split("@media (max-width: 75rem)")[1]?.split("@media")[0] ?? "";
    expect(wideCompactBlock).toMatch(
      /\.app-shell > \.app-shell-relations[\s\S]*position:\s*fixed/,
    );
    expect(wideCompactBlock).toMatch(
      /\.app-shell > \.app-shell-assistant \{[\s\S]*position:\s*fixed/,
    );
  });

  it("assombrit la couleur de texte secondaire claire pour des icônes lisibles", () => {
    const rootBlock = tokensCss.split(".synapse-dark")[0] ?? "";
    expect(rootBlock).toContain("--synapse-color-text-muted: #526076");
  });
});
