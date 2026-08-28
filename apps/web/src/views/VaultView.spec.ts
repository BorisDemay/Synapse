import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

import {
  resetCompactAssistantLayoutState,
  resetSidebarLayoutState,
} from "@synapse/ui";
import { useAuthStore } from "../stores/auth";
import { useVaultStore } from "../stores/vault";
import VaultView from "./VaultView.vue";

const savedSearch = { id: "search-1", label: "À relire", query: "tag:review" };
const noteId = "note-1";

function mockMatchMedia(matches = false) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      media: "(max-width: 75rem)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetSidebarLayoutState();
  resetCompactAssistantLayoutState();
  mockMatchMedia(false);
});

async function mountVault(options?: { stubVaultTree?: boolean }): Promise<{
  router: Router;
  vault: ReturnType<typeof useVaultStore>;
  wrapper: VueWrapper;
}> {
  const stubVaultTree = options?.stubVaultTree ?? true;
  const pinia = createPinia();
  setActivePinia(pinia);
  const vault = useVaultStore();
  const auth = useAuthStore();
  auth.isAuthenticated = true;
  auth.isOfflineSession = true;
  auth.userId = "user-1";
  vault.notes.set(noteId, {
    content: "---\nstatus: actif\n---\n# Note épinglée",
    path: "note-epinglee.md",
    revision: 1,
  });
  vault.preferences = {
    pinnedNoteIds: [noteId],
    recentNoteIds: [noteId],
    restorePoints: [],
    savedSearches: [savedSearch],
    templatesPath: "Templates",
  };
  vi.spyOn(vault, "flushPendingOperations").mockResolvedValue();
  vi.spyOn(vault, "rememberRecentNote").mockResolvedValue();
  vi.spyOn(vault, "hasTrustedDevice").mockResolvedValue(false);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: VaultView, path: "/vault" },
      { component: { template: "<div />" }, path: "/login" },
      { component: { template: "<div />" }, path: "/unlock" },
    ],
  });
  await router.push("/vault");
  await router.isReady();

  const wrapper = mount(VaultView, {
    global: {
      plugins: [pinia, router, [PrimeVue, { unstyled: true }]],
      stubs: {
        AiChat: true,
        AiConversationPanel: true,
        ConflictResolver: true,
        GraphPanel: true,
        MarkdownEditor: {
          props: ["modelValue"],
          template: '<div data-test="markdown-editor">{{ modelValue }}</div>',
        },
        NoteRelationsPanel: true,
        SettingsPanel: true,
        ThemeToggle: true,
        ...(stubVaultTree ? { VaultTree: true } : {}),
      },
    },
  });
  await flushPromises();
  return { router, vault, wrapper };
}

describe("VaultView saved navigation", () => {
  it("opens the local search palette with a saved search query", async () => {
    const { wrapper } = await mountVault();

    await wrapper
      .get('[aria-label="Recherches sauvegardées"] button')
      .trigger("click");

    expect(wrapper.get('[role="dialog"]').isVisible()).toBe(true);
    expect(
      (
        wrapper.get('[aria-label="Rechercher une note ou une commande"]')
          .element as HTMLInputElement
      ).value,
    ).toBe(savedSearch.query);
  });

  it("opens the local search palette with a property query", async () => {
    const { wrapper } = await mountVault();

    await wrapper.get('[aria-label="Propriétés"] button').trigger("click");

    expect(wrapper.get('[role="dialog"]').isVisible()).toBe(true);
    expect(
      (
        wrapper.get('[aria-label="Rechercher une note ou une commande"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("property:status");
  });

  it("opens the content of a pinned note", async () => {
    const { wrapper } = await mountVault();

    await wrapper.get('[aria-label="Notes épinglées"] button').trigger("click");

    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "# Note épinglée",
    );
  });

  it("does not render a recent notes sidebar section", async () => {
    const { wrapper } = await mountVault();

    expect(wrapper.find('[aria-label="Notes récentes"]').exists()).toBe(false);
    expect(wrapper.find(".recent-notes").exists()).toBe(false);
  });
});

describe("VaultView folder import action", () => {
  it("uses icon-only toolbar actions for vault imports", async () => {
    const { wrapper } = await mountVault();

    expect(
      wrapper.get('[aria-label="importer une vault"]').attributes("title"),
    ).toBe("importer une vault");
    expect(
      wrapper.get('[aria-label="importer une note"]').attributes("title"),
    ).toBe("importer une note");
  });

  it("opens the directory picker from the folder import action", async () => {
    const { wrapper } = await mountVault();
    const picker = wrapper.get("input[webkitdirectory]")
      .element as HTMLInputElement;
    const click = vi.spyOn(picker, "click").mockImplementation(() => {});

    await wrapper.get('[aria-label="importer une vault"]').trigger("click");

    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
});

describe("VaultView assistant layout", () => {
  it("keeps relations and conversations closed by default on compact viewports", async () => {
    resetCompactAssistantLayoutState();
    mockMatchMedia(true);

    const { wrapper } = await mountVault();

    const codexButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Codex"));
    expect(codexButton).toBeDefined();
    await codexButton!.trigger("click");

    expect(wrapper.find('[aria-label="Conversations Codex"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[aria-label="Relations de la note"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[aria-label="Assistant d\'écriture"]').exists()).toBe(
      true,
    );
  });
});

describe("VaultView sidebar layout", () => {
  it("toggles sidebar collapse from the explorer toolbar", async () => {
    const { wrapper } = await mountVault();

    expect(wrapper.find(".app-shell--sidebar-collapsed").exists()).toBe(false);

    await wrapper
      .get('[aria-label="Masquer la barre latérale"]')
      .trigger("click");

    expect(wrapper.find(".app-shell--sidebar-collapsed").exists()).toBe(true);
  });

  it("keeps a mini-rail of icons when the sidebar is collapsed", async () => {
    const { wrapper } = await mountVault();

    await wrapper
      .get('[aria-label="Masquer la barre latérale"]')
      .trigger("click");

    expect(wrapper.find('[aria-label="Nouvelle note"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Créer depuis un modèle"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[aria-label="importer une note"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[aria-label="importer une vault"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[aria-label="Afficher la barre latérale"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[aria-label="Ouvrir les paramètres"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[aria-label="Se déconnecter"]').exists()).toBe(true);
    expect(wrapper.find("vault-tree-stub").exists()).toBe(false);
  });

  it("restores the full sidebar from the expand icon", async () => {
    const { wrapper } = await mountVault();

    await wrapper
      .get('[aria-label="Masquer la barre latérale"]')
      .trigger("click");
    await wrapper
      .get('[aria-label="Afficher la barre latérale"]')
      .trigger("click");

    expect(wrapper.find(".app-shell--sidebar-collapsed").exists()).toBe(false);
    expect(wrapper.find("vault-tree-stub").exists()).toBe(true);
  });

  it("exposes footer settings and logout controls with expanded state", async () => {
    const { wrapper } = await mountVault();
    const settings = wrapper.get(".settings-button");
    const logout = wrapper.get(".logout-button");

    expect(settings.attributes("aria-expanded")).toBe("false");
    expect(logout.text()).toContain("Se déconnecter");

    await settings.trigger("click");

    expect(settings.attributes("aria-expanded")).toBe("true");
  });
});

describe("VaultView notes section", () => {
  it("places the new-note action beside the Notes heading", async () => {
    const { wrapper } = await mountVault();
    const heading = wrapper.get(".vault-notes-section-header");

    expect(heading.text()).toContain("Notes");
    expect(heading.find('[aria-label="Nouvelle note"]').exists()).toBe(true);
  });

  it("does not expose new-note in the explorer toolbar", async () => {
    const { wrapper } = await mountVault();

    expect(
      wrapper.find('[role="toolbar"] [aria-label="Nouvelle note"]').exists(),
    ).toBe(false);
  });

  it("does not list the default unsaved draft in the vault tree", async () => {
    const { wrapper } = await mountVault({ stubVaultTree: false });

    const labels = wrapper
      .findAll(".vault-tree-label")
      .map((node) => node.text());
    expect(labels).not.toContain("Nouvelle note");
    expect(labels).toContain("Note épinglée");
  });

  it("starts a fresh draft when the Notes plus action is clicked", async () => {
    const { wrapper } = await mountVault();

    await wrapper.get('[aria-label="Notes épinglées"] button').trigger("click");
    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "# Note épinglée",
    );

    await wrapper
      .get(".vault-notes-section-header [aria-label='Nouvelle note']")
      .trigger("click");

    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "# Nouvelle note",
    );
  });
});
