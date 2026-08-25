import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

import { useAuthStore } from "../stores/auth";
import { useVaultStore } from "../stores/vault";
import VaultView from "./VaultView.vue";

const savedSearch = { id: "search-1", label: "À relire", query: "tag:review" };
const noteId = "note-1";

async function mountVault(): Promise<{
  router: Router;
  vault: ReturnType<typeof useVaultStore>;
  wrapper: VueWrapper;
}> {
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
        VaultTree: true,
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

  it("renders recent notes as sidebar nav items", async () => {
    const { wrapper } = await mountVault();
    const recent = wrapper.get('[aria-label="Notes récentes"] button');

    expect(recent.classes()).toContain("sidebar-nav-item");
    expect(recent.text()).toContain("Note épinglée");
  });
});

describe("VaultView folder import action", () => {
  it("uses the same PrimeVue sidebar button as the other vault actions", async () => {
    const { wrapper } = await mountVault();
    const folder = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Importer un dossier"));

    expect(folder).toBeTruthy();
    expect(folder!.classes()).toContain("new-note-button");
    expect(folder!.attributes("data-pc-name")).toBe("button");
  });

  it("opens the directory picker from the folder import action", async () => {
    const { wrapper } = await mountVault();
    const picker = wrapper.get("input[webkitdirectory]")
      .element as HTMLInputElement;
    const click = vi.spyOn(picker, "click").mockImplementation(() => {});

    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Importer un dossier"))!
      .trigger("click");

    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
});
