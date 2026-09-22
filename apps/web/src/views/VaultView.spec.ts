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
const editorFocusCalls: number[] = [];
const appShellCloseCalls: number[] = [];

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
  window.sessionStorage.clear();
  editorFocusCalls.length = 0;
  appShellCloseCalls.length = 0;
  resetSidebarLayoutState();
  resetCompactAssistantLayoutState();
  mockMatchMedia(false);
});

async function mountVault(options?: {
  stubVaultTree?: boolean;
  emptyVault?: boolean;
  recentNoteIds?: string[];
  attachToBody?: boolean;
}): Promise<{
  router: Router;
  vault: ReturnType<typeof useVaultStore>;
  auth: ReturnType<typeof useAuthStore>;
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
  vault.unlock(new Uint8Array(32), "vault-1");
  if (!options?.emptyVault) {
    vault.notes.set(noteId, {
      content: "---\nstatus: actif\n---\n# Note épinglée",
      path: "note-epinglee.md",
      revision: 1,
    });
  }
  vault.preferences = {
    pinnedNoteIds: options?.emptyVault ? [] : [noteId],
    recentNoteIds:
      options?.recentNoteIds ?? (options?.emptyVault ? [] : [noteId]),
    restorePoints: [],
    savedSearches: [savedSearch],
    templatesPath: "Templates",
  };
  vi.spyOn(vault, "synchronize").mockResolvedValue(true);
  vi.spyOn(vault, "loadHistory").mockResolvedValue();
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
    attachTo: options?.attachToBody ? document.body : undefined,
    global: {
      plugins: [pinia, router, [PrimeVue, { unstyled: true }]],
      stubs: {
        AiChat: true,
        ConflictResolver: true,
        GraphPanel: true,
        AppShell: {
          props: ["sidebarCollapsed"],
          template: `<div class="app-shell" :class="{ 'app-shell--sidebar-collapsed': sidebarCollapsed }">
            <aside class="app-shell-sidebar"><slot name="navigation" /></aside>
            <main class="app-shell-content"><slot /></main>
            <aside v-if="$slots.relations" class="app-shell-relations" aria-label="Relations de la note"><slot name="relations" /></aside>
            <aside v-if="$slots.assistant" class="app-shell-assistant" aria-label="Assistant d'écriture"><slot name="assistant" /></aside>
          </div>`,
          setup(
            _props: unknown,
            { expose }: { expose: (api: object) => void },
          ) {
            expose({ closeNavigation: () => appShellCloseCalls.push(1) });
          },
        },
        MarkdownEditor: {
          props: ["modelValue"],
          template: '<div data-test="markdown-editor">{{ modelValue }}</div>',
          setup(
            _props: unknown,
            { expose }: { expose: (api: object) => void },
          ) {
            expose({ focus: () => editorFocusCalls.push(1) });
          },
        },
        NoteRelationsPanel: true,
        SettingsPanel: true,
        ThemeToggle: true,
        ...(stubVaultTree ? { VaultTree: true } : {}),
      },
    },
  });
  await flushPromises();
  return { router, vault, auth, wrapper };
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

  it("reopens the most recent valid existing note on mount", async () => {
    const { wrapper } = await mountVault({ recentNoteIds: ["ghost", noteId] });

    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "# Note épinglée",
    );
  });

  it("ignores recent ids without an existing note", async () => {
    const { wrapper } = await mountVault({ recentNoteIds: ["ghost"] });

    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "# Nouvelle note",
    );
  });

  it("prioritizes recent notes in a dedicated sidebar section", async () => {
    const { wrapper } = await mountVault({ recentNoteIds: ["ghost", noteId] });
    const recents = wrapper.get('[aria-label="Notes récentes"]');

    expect(editorFocusCalls).toHaveLength(0);
    expect(recents.text()).toContain("Note épinglée");
    expect(recents.text()).not.toContain("ghost");

    await recents.get("button").trigger("click");

    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "# Note épinglée",
    );
    expect(editorFocusCalls).toHaveLength(1);
  });
});

describe("VaultView folder import action", () => {
  it("normalizes the French import labels", async () => {
    const { wrapper } = await mountVault();

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
  });

  it("opens the directory picker from the folder import action", async () => {
    const { wrapper } = await mountVault();
    const picker = wrapper.get("input[webkitdirectory]")
      .element as HTMLInputElement;
    const click = vi.spyOn(picker, "click").mockImplementation(() => {});

    await wrapper
      .get('[aria-label="Importer un dossier Markdown"]')
      .trigger("click");

    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("opens the ZIP picker from the ZIP import action", async () => {
    const { wrapper } = await mountVault();
    const picker = wrapper.get("input[accept='.zip']")
      .element as HTMLInputElement;
    const click = vi.spyOn(picker, "click").mockImplementation(() => {});

    await wrapper
      .get('[aria-label="Importer un ZIP Markdown (.zip)"]')
      .trigger("click");

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
      .find((button) => button.text().includes("Assistant"));
    expect(codexButton).toBeDefined();
    await codexButton!.trigger("click");

    expect(
      wrapper.find('[aria-label="Conversations de l’assistant"]').exists(),
    ).toBe(false);
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
    expect(
      wrapper.find('[aria-label="Importer un ZIP Markdown (.zip)"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[aria-label="Importer un dossier Markdown"]').exists(),
    ).toBe(true);
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

it("updates the selected clean editor from sync without echo-saving", async () => {
  const { wrapper, vault } = await mountVault();
  await wrapper.get('[aria-label="Notes épinglées"] button').trigger("click");
  const save = vi.spyOn(vault, "saveNote").mockResolvedValue({} as never);
  vault.notes.set(noteId, {
    content: "# remote update",
    path: "note-epinglee.md",
    revision: 2,
  });
  await flushPromises();
  expect(wrapper.get('[data-test="markdown-editor"]').text()).toBe(
    "# remote update",
  );
  expect(save).not.toHaveBeenCalled();
});
it("keeps an unsaved draft and its original base when remote sync arrives before autosave", async () => {
  const { wrapper, vault } = await mountVault();
  vault.headRevision = 4;
  await wrapper.get('[aria-label="Notes épinglées"] button').trigger("click");
  const editor = wrapper.findComponent(
    '[data-test="markdown-editor"]',
  ) as VueWrapper;
  editor.vm.$emit("update:modelValue", "# local draft");
  await flushPromises();
  vault.headRevision = 5;
  vault.notes.set(noteId, {
    content: "# remote update",
    path: "note-epinglee.md",
    revision: 5,
  });
  await flushPromises();
  expect(wrapper.get('[data-test="markdown-editor"]').text()).toBe(
    "# local draft",
  );
  const save = vi.spyOn(vault, "saveNote").mockResolvedValue({} as never);
  editor.vm.$emit("save", "# local draft");
  await flushPromises();
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      baseRevision: 4,
      content: "# local draft",
      id: noteId,
    }),
  );
});

it("persists a pending draft under its original note before switching notes", async () => {
  const { wrapper, vault } = await mountVault();
  await wrapper.get('[aria-label="Notes épinglées"] button').trigger("click");
  const save = vi.spyOn(vault, "saveNote").mockResolvedValue({} as never);
  const editor = wrapper.findComponent(
    '[data-test="markdown-editor"]',
  ) as VueWrapper;
  editor.vm.$emit("update:modelValue", "# original draft");
  await flushPromises();
  vault.notes.set("second", { content: "# second", revision: 1 });
  wrapper.findComponent({ name: "VaultTree" }).vm.$emit("select", "second");
  await flushPromises();
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ id: noteId, content: "# original draft" }),
  );
  expect(wrapper.get('[data-test="markdown-editor"]').text()).toBe("# second");
});

it("finishes the current note’s pending drafts before switching during an in-flight save", async () => {
  const { wrapper, vault } = await mountVault();
  await wrapper.get('[aria-label="Notes épinglées"] button').trigger("click");
  let release!: (value: never) => void;
  const save = vi
    .spyOn(vault, "saveNote")
    .mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue({} as never);
  const editor = wrapper.findComponent(
    '[data-test="markdown-editor"]',
  ) as VueWrapper;
  editor.vm.$emit("update:modelValue", "# first");
  editor.vm.$emit("save", "# first");
  await flushPromises();
  editor.vm.$emit("update:modelValue", "# latest original");
  editor.vm.$emit("save", "# latest original");
  await flushPromises();
  vault.notes.set("second", { content: "# second", revision: 1 });
  wrapper.findComponent({ name: "VaultTree" }).vm.$emit("select", "second");
  await flushPromises();
  expect(wrapper.get('[data-test="markdown-editor"]').text()).toBe(
    "# latest original",
  );
  release({} as never);
  await flushPromises();
  editor.vm.$emit("update:modelValue", "# second edit");
  editor.vm.$emit("save", "# second edit");
  await flushPromises();
  expect(save.mock.calls.map(([input]) => [input.id, input.content])).toEqual([
    [noteId, "# first"],
    [noteId, "# latest original"],
    ["second", "# second edit"],
  ]);
});

it("retains a rejected durable draft and blocks logout and note switching", async () => {
  const { wrapper, vault } = await mountVault();
  await wrapper.get('[aria-label="Notes épinglées"] button').trigger("click");
  vi.spyOn(vault, "saveNote").mockRejectedValue(new Error("quota"));
  const editor = wrapper.findComponent(
    '[data-test="markdown-editor"]',
  ) as VueWrapper;
  editor.vm.$emit("update:modelValue", "# unsaved quota draft");
  vault.notes.set("second", { content: "# second", revision: 1 });
  wrapper.findComponent({ name: "VaultTree" }).vm.$emit("select", "second");
  await flushPromises();
  expect(wrapper.get('[data-test="markdown-editor"]').text()).toBe(
    "# unsaved quota draft",
  );
  const lock = vi.spyOn(vault, "lockAndRequirePassphrase");
  wrapper.findComponent({ name: "SettingsPanel" }).vm.$emit("lock-vault");
  await flushPromises();
  expect(lock).not.toHaveBeenCalled();
  await wrapper.get(".logout-button").trigger("click");
  await flushPromises();
  expect(wrapper.get('[data-test="markdown-editor"]').text()).toBe(
    "# unsaved quota draft",
  );
});

it("does not claim an offline unsaved draft is already durable", async () => {
  const { wrapper, vault } = await mountVault();
  vault.syncStatus = "offline";
  (
    wrapper.findComponent('[data-test="markdown-editor"]') as VueWrapper
  ).vm.$emit("update:modelValue", "# dirty offline draft");
  await flushPromises();
  expect(wrapper.get(".save-status").attributes("data-state")).toBe("draft");
  wrapper.unmount();
});

it("saves the latest draft before deleting and offers an explicit undo", async () => {
  const { wrapper, vault } = await mountVault();
  const save = vi.spyOn(vault, "saveNote").mockResolvedValue({} as never);
  const remove = vi
    .spyOn(vault, "deleteNote")
    .mockImplementation(async (id) => {
      vault.notes.delete(id);
      return {} as never;
    });
  (
    wrapper.findComponent('[data-test="markdown-editor"]') as VueWrapper
  ).vm.$emit("update:modelValue", "# last draft before delete");
  wrapper.findComponent({ name: "VaultTree" }).vm.$emit("delete", noteId);
  await flushPromises();
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      id: noteId,
      content: "# last draft before delete",
    }),
  );
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(
    remove.mock.invocationCallOrder[0],
  );
  expect(wrapper.find('[aria-label="Annuler la suppression"]').exists()).toBe(
    true,
  );
  wrapper.unmount();
});

it("does not delete when the latest draft cannot be durably saved", async () => {
  const { wrapper, vault } = await mountVault();
  vi.spyOn(vault, "saveNote").mockRejectedValue(new Error("quota"));
  const remove = vi.spyOn(vault, "deleteNote").mockResolvedValue({} as never);
  (
    wrapper.findComponent('[data-test="markdown-editor"]') as VueWrapper
  ).vm.$emit("update:modelValue", "# retained draft");
  wrapper.findComponent({ name: "VaultTree" }).vm.$emit("delete", noteId);
  await flushPromises();
  expect(remove).not.toHaveBeenCalled();
  expect(wrapper.get('[data-test="markdown-editor"]').text()).toBe(
    "# retained draft",
  );
  expect(wrapper.get(".save-status").attributes("data-state")).toBe("error");
  wrapper.unmount();
});

it("gives conflict resolution the workspace without competing editor height", async () => {
  const { wrapper, vault } = await mountVault();
  vault.activeConflict = {
    noteId,
    base: "# base",
    local: "# local",
    remote: "# remote",
    manualDraft: "# draft",
    conflict: {} as never,
  };
  await flushPromises();
  expect(wrapper.findComponent({ name: "ConflictResolver" }).exists()).toBe(
    true,
  );
  expect(wrapper.find('[data-test="markdown-editor"]').exists()).toBe(false);
  vault.activeConflict = null;
  await flushPromises();
  expect(wrapper.find('[data-test="markdown-editor"]').exists()).toBe(true);
});

describe("VaultView writing-first workspace", () => {
  it("exposes a visible search trigger with a Ctrl+K hint that opens the palette", async () => {
    const { wrapper } = await mountVault();
    const trigger = wrapper.get(".vault-search-trigger");

    expect(trigger.text()).toContain("Rechercher dans les notes");
    expect(trigger.get("kbd").text()).toBe("Ctrl+K");

    await trigger.trigger("click");

    expect(wrapper.get('[role="dialog"]').isVisible()).toBe(true);
  });

  it("moves the editor cursor forward immediately when creating a note", async () => {
    const { wrapper } = await mountVault();
    expect(editorFocusCalls).toHaveLength(0);

    await wrapper
      .get(".vault-notes-section-header [aria-label='Nouvelle note']")
      .trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "# Nouvelle note",
    );
    expect(editorFocusCalls).toHaveLength(1);
  });

  it("shows a path breadcrumb and the current note title instead of identifiers", async () => {
    const { wrapper, vault } = await mountVault();
    vault.notes.set("nested", {
      content: "# Imbriquée\n\nCorps.",
      path: "projets/sous-dossier/imbriquee.md",
      revision: 1,
    });
    wrapper.findComponent({ name: "VaultTree" }).vm.$emit("select", "nested");
    await flushPromises();

    const breadcrumb = wrapper.get(".note-breadcrumb");
    expect(breadcrumb.text()).toContain("projets");
    expect(breadcrumb.text()).toContain("sous-dossier");
    expect(breadcrumb.text()).toContain("imbriquee.md");
    expect(wrapper.get(".workspace-titleblock h2").text()).toBe("Imbriquée");
  });

  it("keeps full note paths so folders survive in the tree", async () => {
    const { wrapper, vault } = await mountVault({ stubVaultTree: false });
    vault.notes.set("nested", {
      content: "# Imbriquée",
      path: "projets/imbriquee.md",
      revision: 1,
    });
    await flushPromises();

    expect(wrapper.find('[data-kind="folder"]').text()).toContain("projets");
    expect(wrapper.find('[data-kind="note"]').text()).toContain("Imbriquée");
  });

  it("shows full paths for duplicate filenames in search results", async () => {
    const { wrapper, vault } = await mountVault();
    vault.notes.set("dup-1", {
      content: "# Journal\n\n",
      path: "projets/journal.md",
      revision: 1,
    });
    vault.notes.set("dup-2", {
      content: "# Journal\n\n",
      path: "archives/journal.md",
      revision: 1,
    });
    await flushPromises();

    const palette = wrapper.findComponent({ name: "SearchPalette" });
    palette.vm.$emit("update:query", "journal");
    await flushPromises();

    const results = palette.props("results") as { hint?: string; id: string }[];
    const hints = results.map((result) => result.hint);
    expect(hints).toContain("projets/journal.md");
    expect(hints).toContain("archives/journal.md");
  });

  it("follows external selection in the tree via the selectedId prop", async () => {
    const { wrapper, vault } = await mountVault();
    vault.notes.set("second", {
      content: "# Seconde",
      path: "projets/seconde.md",
      revision: 1,
    });

    const palette = wrapper.findComponent({ name: "SearchPalette" });
    palette.vm.$emit("select", "second");
    await flushPromises();

    const tree = wrapper.findComponent({ name: "VaultTree" });
    expect(tree.props("selectedId")).toBe("second");
  });

  it("offers write or import with a dismissible per-session autosave hint in the empty state", async () => {
    const { wrapper } = await mountVault({ emptyVault: true });
    const emptyState = wrapper.get(".vault-empty-state");

    expect(emptyState.text()).toContain("Écrire");
    expect(emptyState.text()).toContain("Importer");
    expect(emptyState.get(".autosave-hint").text()).toContain(
      "enregistrement automatique",
    );

    await emptyState.get('[data-test="empty-state-write"]').trigger("click");
    await flushPromises();
    expect(editorFocusCalls).toHaveLength(1);

    await emptyState
      .get('[data-test="autosave-hint-dismiss"]')
      .trigger("click");

    expect(wrapper.find(".autosave-hint").exists()).toBe(false);
    expect(
      window.sessionStorage.getItem("synapse-autosave-hint-dismissed"),
    ).toBe("true");
  });

  it("closes the navigation drawer after a successful selection and a new note", async () => {
    const { wrapper } = await mountVault();
    const afterMount = appShellCloseCalls.length;

    await wrapper.get('[aria-label="Notes épinglées"] button').trigger("click");
    expect(appShellCloseCalls.length).toBe(afterMount + 1);

    await wrapper
      .get(".vault-notes-section-header [aria-label='Nouvelle note']")
      .trigger("click");
    expect(appShellCloseCalls.length).toBe(afterMount + 2);
  });
});

describe("VaultView save feedback", () => {
  function saveStatus(wrapper: VueWrapper) {
    return wrapper.get(".save-status");
  }

  it("never claims Synchronisé in local-only or offline sessions", async () => {
    const { wrapper, auth } = await mountVault();
    auth.isLocalMode = true;
    await flushPromises();

    const status = saveStatus(wrapper);
    expect(status.attributes("data-state")).toBe("local");
    expect(status.text()).toBe("Enregistré localement");
    expect(status.text()).not.toContain("Synchronisé");
  });

  it("claims Synchronisé only for a connected, acked state", async () => {
    const { wrapper, auth, vault } = await mountVault();
    auth.isOfflineSession = false;
    auth.isLocalMode = false;
    vault.syncStatus = "synced";
    await flushPromises();

    expect(saveStatus(wrapper).attributes("data-state")).toBe("synced");
    expect(saveStatus(wrapper).text()).toBe("Synchronisé");
  });

  it("distinguishes the unsaved draft from durable local saves", async () => {
    const { wrapper } = await mountVault();
    const editor = wrapper.findComponent(
      '[data-test="markdown-editor"]',
    ) as VueWrapper;

    editor.vm.$emit("update:modelValue", "# local draft");
    await flushPromises();

    const status = saveStatus(wrapper);
    expect(status.attributes("data-state")).toBe("draft");
    expect(status.text()).toBe("Brouillon modifié");
  });

  it("distinguishes durable local saves pending synchronization from Synchronisé", async () => {
    const { wrapper, auth, vault } = await mountVault();
    auth.isOfflineSession = false;
    auth.isLocalMode = false;
    vault.syncStatus = "synced";
    vault.pendingNoteIds = [noteId];
    await flushPromises();

    const status = saveStatus(wrapper);
    expect(status.attributes("data-state")).toBe("durable-pending");
    expect(status.text()).toContain("synchronisation en attente");
    expect(status.text()).not.toBe("Synchronisé");
  });

  it("exposes saving, offline, error and conflict states", async () => {
    const { wrapper, auth, vault } = await mountVault();
    auth.isOfflineSession = false;
    auth.isLocalMode = false;

    vault.syncStatus = "saving";
    await flushPromises();
    expect(saveStatus(wrapper).attributes("data-state")).toBe("syncing");
    expect(saveStatus(wrapper).text()).toBe("Synchronisation…");

    vault.syncStatus = "offline";
    await flushPromises();
    expect(saveStatus(wrapper).attributes("data-state")).toBe("offline");
    expect(saveStatus(wrapper).text()).toContain("Hors ligne");

    vault.syncStatus = "error";
    await flushPromises();
    expect(saveStatus(wrapper).attributes("data-state")).toBe("sync-error");
    expect(saveStatus(wrapper).text()).toContain("Enregistré localement");

    vault.syncStatus = "conflict";
    await flushPromises();
    expect(saveStatus(wrapper).attributes("data-state")).toBe("conflict");
  });
});

describe("VaultView note tools", () => {
  it("opens backlinks and history without any assistant", async () => {
    const { wrapper } = await mountVault();

    const relations = wrapper
      .findAll(".workspace-tool")
      .find((button) => button.text() === "Relations");
    expect(relations).toBeDefined();
    await relations!.trigger("click");

    expect(wrapper.findComponent({ name: "NoteRelationsPanel" }).exists()).toBe(
      true,
    );
    expect(wrapper.find('[aria-label="Assistant d\'écriture"]').exists()).toBe(
      false,
    );
  });

  it("closes relations when a tree attachment opens the assistant", async () => {
    const { wrapper } = await mountVault();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Relations")!
      .trigger("click");
    wrapper.findComponent({ name: "VaultTree" }).vm.$emit("attach", noteId);
    await flushPromises();
    expect(wrapper.findComponent({ name: "AiChat" }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: "NoteRelationsPanel" }).exists()).toBe(
      false,
    );
    wrapper.unmount();
  });

  it("keeps at most one side tool open at a time", async () => {
    const { wrapper } = await mountVault();

    const tool = (label: string) =>
      wrapper
        .findAll(".workspace-tool")
        .find((button) => button.text() === label)!;

    await tool("Relations").trigger("click");
    expect(wrapper.findComponent({ name: "NoteRelationsPanel" }).exists()).toBe(
      true,
    );

    await tool("Graphe").trigger("click");
    expect(wrapper.findComponent({ name: "GraphPanel" }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: "NoteRelationsPanel" }).exists()).toBe(
      false,
    );

    await tool("Assistant").trigger("click");
    expect(wrapper.find('[aria-label="Assistant d\'écriture"]').exists()).toBe(
      true,
    );
    expect(wrapper.findComponent({ name: "GraphPanel" }).exists()).toBe(false);
  });

  it("renders the conversation list inside the assistant slot with a back-to-chat action", async () => {
    const { wrapper } = await mountVault();

    const assistant = wrapper
      .findAll(".workspace-tool")
      .find((button) => button.text() === "Assistant")!;
    await assistant.trigger("click");
    expect(wrapper.find('[aria-label="Assistant d\'écriture"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[aria-label="Conversations de l’assistant"]').exists(),
    ).toBe(false);

    wrapper.findComponent({ name: "AiChat" }).vm.$emit("toggle-conversations");
    await flushPromises();

    expect(
      wrapper.find('[aria-label="Conversations de l’assistant"]').exists(),
    ).toBe(true);
    expect(wrapper.find(".assistant-back-to-chat").text()).toContain(
      "Retour à la conversation",
    );

    await wrapper.get(".assistant-back-to-chat").trigger("click");
    expect(
      wrapper.find('[aria-label="Conversations de l’assistant"]').exists(),
    ).toBe(false);
    expect(wrapper.findComponent({ name: "AiChat" }).exists()).toBe(true);
  });

  it("keeps quieter secondary workspace controls instead of prominent buttons", async () => {
    const { wrapper } = await mountVault();

    for (const label of ["Relations", "Graphe", "Désépingler", "Assistant"]) {
      expect(
        wrapper
          .findAll(".workspace-tool")
          .some((button) => button.text() === label),
      ).toBe(true);
    }
    expect(
      wrapper.find(".workspace-meta button[class*='p-button']").exists(),
    ).toBe(false);
  });
});

describe("VaultView attachment preview accessibility", () => {
  it("moves focus into the dialog and closes it with Escape", async () => {
    const { wrapper, vault } = await mountVault({ attachToBody: true });
    vault.attachments.set("att-1", {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      path: "attachments/photo.png",
      revision: 1,
    });
    await flushPromises();

    wrapper.findComponent({ name: "VaultTree" }).vm.$emit("select", "att-1");
    await flushPromises();

    const dialog = wrapper.get('[role="dialog"][aria-modal="true"]');
    expect(document.activeElement).toBe(
      dialog.get('button[aria-label="Fermer l’aperçu"]').element,
    );

    await dialog.trigger("keydown", { key: "Escape" });
    await flushPromises();

    expect(wrapper.find('[role="dialog"][aria-modal="true"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });
});
