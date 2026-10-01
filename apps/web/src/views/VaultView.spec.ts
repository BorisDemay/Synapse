import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

import {
  resetCompactAssistantLayoutState,
  resetOverlayStack,
  resetSidebarLayoutState,
  synapseTooltip,
} from "@synapse/ui";
import QuickAssistantPrompt from "../components/QuickAssistantPrompt.vue";
import { useAssistantStore } from "../stores/assistant";
import { useAuthStore } from "../stores/auth";
import { useVaultStore } from "../stores/vault";
import VaultView from "./VaultView.vue";
import { clearToasts, toasts } from "../notifications/toasts";

// L'export PDF produit un fichier en mémoire puis le télécharge : jsdom ne
// construit pas de blob, on espionne donc la fonction pour vérifier qu'aucune
// boîte d'impression n'est ouverte.
vi.mock("@synapse/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@synapse/ui")>();
  return { ...actual, downloadNotePdf: vi.fn() };
});

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
  clearToasts();
  window.localStorage.clear();
  window.sessionStorage.clear();
  editorFocusCalls.length = 0;
  appShellCloseCalls.length = 0;
  resetSidebarLayoutState();
  resetCompactAssistantLayoutState();
  resetOverlayStack();
  mockMatchMedia(false);
});

async function mountVault(options?: {
  stubVaultTree?: boolean;
  emptyVault?: boolean;
  recentNoteIds?: string[];
  attachToBody?: boolean;
  noteQuery?: string;
  notes?: Record<string, { content: string; path: string }>;
  attachments?: Record<
    string,
    { bytes: Uint8Array; contentType: string; path: string }
  >;
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
  for (const [id, note] of Object.entries(options?.notes ?? {})) {
    vault.notes.set(id, { ...note, revision: 1 });
  }
  for (const [id, file] of Object.entries(options?.attachments ?? {})) {
    vault.attachments.set(id, { ...file, revision: 1 });
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
  await router.push(
    options?.noteQuery
      ? { path: "/vault", query: { note: options.noteQuery } }
      : "/vault",
  );
  router.addRoute({ path: "/leave", component: { template: "<div />" } });
  await router.isReady();

  const wrapper = mount(VaultView, {
    attachTo: options?.attachToBody ? document.body : undefined,
    global: {
      plugins: [pinia, router, [PrimeVue, { unstyled: true }]],
      directives: { "synapse-tooltip": synapseTooltip },
      stubs: {
        AiChat: true,
        ConflictResolver: true,
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
          name: "MarkdownEditor",
          props: ["modelValue", "hideFirstHeading", "attachmentUrls"],
          template: '<div data-test="markdown-editor">{{ modelValue }}</div>',
          setup(
            _props: unknown,
            { expose }: { expose: (api: object) => void },
          ) {
            expose({ focus: () => editorFocusCalls.push(1) });
          },
        },
        HistoryPanel: true,
        SettingsPanel: true,
        ThemeToggle: true,
        ...(stubVaultTree ? { VaultTree: true } : {}),
      },
    },
  });
  await flushPromises();
  return { router, vault, auth, wrapper };
}

describe("VaultView embedded attachments", () => {
  it("loads saved image blobs on opening and refreshes replacements at the same path", async () => {
    const create = vi
      .fn()
      .mockReturnValueOnce("blob:saved-photo")
      .mockReturnValueOnce("blob:updated-photo");
    const revoke = vi.fn();
    const previousCreate = URL.createObjectURL;
    const previousRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    try {
      const { wrapper, vault } = await mountVault({
        attachments: {
          "att-1": {
            bytes: new Uint8Array([1, 2, 3]),
            contentType: "image/png",
            path: "attachments/photo.png",
          },
        },
        notes: {
          [noteId]: {
            content: "# Note épinglée\n\n![photo](attachments/photo.png)",
            path: "note-epinglee.md",
          },
        },
      });
      const editor = wrapper.findComponent({ name: "MarkdownEditor" });
      expect(editor.props("modelValue")).toContain(
        "![photo](attachments/photo.png)",
      );
      expect(editor.props("attachmentUrls")).toEqual({
        "attachments/photo.png": "blob:saved-photo",
      });
      vault.attachments.set("att-1", {
        bytes: new Uint8Array([4, 5, 6]),
        contentType: "image/png",
        path: "attachments/photo.png",
        revision: 2,
      });
      await flushPromises();
      expect(editor.props("attachmentUrls")).toEqual({
        "attachments/photo.png": "blob:updated-photo",
      });
      expect(revoke).toHaveBeenCalledWith("blob:saved-photo");
      wrapper.unmount();
    } finally {
      URL.createObjectURL = previousCreate;
      URL.revokeObjectURL = previousRevoke;
    }
  });

  it("keeps attachments stored but out of the Notes tree", async () => {
    const { wrapper, vault } = await mountVault({ stubVaultTree: false });
    vault.attachments.set("att-1", {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      path: "attachments/photo.png",
      revision: 1,
    });
    await flushPromises();

    expect(wrapper.find('[data-kind="attachment"]').exists()).toBe(false);
    expect(
      wrapper.findAll(".vault-tree-label").map((item) => item.text()),
    ).not.toContain("attachments");
    expect(vault.attachments.has("att-1")).toBe(true);
  });
});

describe("VaultView note title", () => {
  it("uses the header as the sole title control while keeping full Markdown canonical", async () => {
    const { wrapper } = await mountVault();
    const header = wrapper.get<HTMLInputElement>(
      '[aria-label="Titre de la note"]',
    );
    const editor = wrapper.findComponent({ name: "MarkdownEditor" });
    expect(header.element.value).toBe("Note épinglée");
    expect(editor.props("hideFirstHeading")).toBe(true);
    expect(editor.props("modelValue")).toBe(
      "---\nstatus: actif\n---\n# Note épinglée",
    );
  });
});

describe("VaultView saved navigation", () => {
  it("checks the model catalog on focus while the vault is open", async () => {
    const { wrapper } = await mountVault();
    const assistant = useAssistantStore();
    const refresh = vi
      .spyOn(assistant, "refreshModelsIfStale")
      .mockResolvedValue();

    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("durably saves a dirty draft before allowing route navigation", async () => {
    const { wrapper, router, vault } = await mountVault();
    const save = vi.spyOn(vault, "saveNote").mockResolvedValue({} as never);
    wrapper
      .findComponent({ name: "MarkdownEditor" })
      .vm.$emit("update:modelValue", "# Draft");

    await router.push("/leave");
    await flushPromises();

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ id: noteId, content: "# Draft" }),
    );
    expect(router.currentRoute.value.path).toBe("/leave");
    wrapper.unmount();
  });

  it("blocks route navigation when the dirty draft cannot be durably saved", async () => {
    const { wrapper, router, vault } = await mountVault();
    vi.spyOn(vault, "saveNote").mockRejectedValue(new Error("storage full"));
    wrapper
      .findComponent({ name: "MarkdownEditor" })
      .vm.$emit("update:modelValue", "# Draft");

    await router.push("/leave");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/vault");
    expect(wrapper.text()).toContain("Échec de l’enregistrement local");
    wrapper.unmount();
  });

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

    expect(wrapper.get('[data-test="markdown-editor"]').text()).toBe("");
  });

  it("hides the recent notes section while keeping other navigation", async () => {
    const { wrapper } = await mountVault({ recentNoteIds: ["ghost", noteId] });

    expect(wrapper.find('[aria-label="Notes récentes"]').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Notes épinglées"]').text()).toContain(
      "Note épinglée",
    );
    expect(
      wrapper.get('[aria-label="Recherches sauvegardées"]').text(),
    ).toContain(savedSearch.label);
    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "# Note épinglée",
    );
  });
});

describe("VaultView folder import action", () => {
  it("normalizes the French import labels", async () => {
    const { wrapper } = await mountVault();

    for (const label of [
      "Importer un ZIP Markdown (.zip)",
      "Importer un dossier Markdown",
    ]) {
      const action = wrapper.get(`[aria-label="${label}"]`);

      expect(action.attributes("aria-label")).toBe(label);
      expect(action.attributes("title")).toBeUndefined();
    }
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

  it("renders the import preview as a contained readable card", async () => {
    const { wrapper } = await mountVault();
    const file = new File(["# Import\n\nContenu synthétique."], "Import.md", {
      type: "text/markdown",
    });
    Object.defineProperties(file, {
      arrayBuffer: {
        configurable: true,
        value: async () =>
          new TextEncoder().encode("# Import\n\nContenu synthétique.").buffer,
      },
      webkitRelativePath: {
        configurable: true,
        value: "Imported/Import.md",
      },
    });
    const picker = wrapper.get("input[webkitdirectory]")
      .element as HTMLInputElement;
    Object.defineProperty(picker, "files", {
      configurable: true,
      value: [file],
    });

    await wrapper.get("input[webkitdirectory]").trigger("change");
    await flushPromises();

    const preview = wrapper.get(".import-preview");
    expect(preview.classes()).toContain("import-preview-card");
    const noteSummary = preview
      .get(".import-preview-summary")
      .findAll("article")[0]!;
    expect(noteSummary.text()).toContain("1");
    expect(noteSummary.text()).toContain("note");
    expect(preview.get(".import-preview-details").text()).toContain(
      "Imported/Import.md",
    );
    expect(
      preview.get(".import-preview-actions").findAll("button"),
    ).toHaveLength(2);
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

    expect(wrapper.get('[data-test="markdown-editor"]').text()).toBe("");
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
  expect(wrapper.find(".deletion-notice").exists()).toBe(false);
  const undoToast = toasts.value.find(
    (toast) => toast.action?.label === "Annuler la suppression",
  );
  expect(undoToast?.kind).toBe("success");
  expect(undoToast?.message).toContain("Note épinglée");
  const restore = vi
    .spyOn(vault, "restoreDeletedItem")
    .mockResolvedValue({} as never);
  await undoToast?.action?.run();
  expect(restore).toHaveBeenCalledWith(noteId);
  wrapper.unmount();
});

it("purges vault notification text and undo actions on lock", async () => {
  const { wrapper, vault } = await mountVault();
  vi.spyOn(vault, "deleteNote").mockImplementation(async (id) => {
    vault.notes.delete(id);
    return {} as never;
  });
  wrapper.findComponent({ name: "VaultTree" }).vm.$emit("delete", noteId);
  await flushPromises();
  expect(toasts.value[0]?.message).toContain("Note épinglée");
  vault.lock();
  await flushPromises();
  expect(toasts.value).toHaveLength(0);
  wrapper.unmount();
});

it("routes a failed deletion to a persistent error toast without removing the note", async () => {
  const { wrapper, vault } = await mountVault();
  vi.spyOn(vault, "deleteNote").mockRejectedValue(new Error("private content"));
  wrapper.findComponent({ name: "VaultTree" }).vm.$emit("delete", noteId);
  await flushPromises();
  expect(vault.notes.has(noteId)).toBe(true);
  expect(toasts.value.at(-1)).toMatchObject({
    kind: "error",
    message: "Suppression impossible. Votre contenu est conservé ; réessayez.",
  });
  expect(JSON.stringify(toasts.value)).not.toContain("private content");
  expect(wrapper.find(".workspace-error").exists()).toBe(false);
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

    expect(wrapper.get('[data-test="markdown-editor"]').text()).toBe("");
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
    expect(breadcrumb.text()).not.toContain("imbriquee.md");
    const title = wrapper.get('input[aria-label="Titre de la note"]');
    expect((title.element as HTMLInputElement).value).toBe("Imbriquée");
  });

  it("n'affiche aucun fil d'Ariane pour une note à la racine du coffre", async () => {
    const { wrapper, vault } = await mountVault();
    vault.notes.set("racine", {
      content: "# Racine",
      path: "01a0d483-e5b2-7ebd-88e4-a98e29eca135.md",
      revision: 1,
    });
    wrapper.findComponent({ name: "VaultTree" }).vm.$emit("select", "racine");
    await flushPromises();

    expect(wrapper.find(".note-breadcrumb").exists()).toBe(false);
    expect(
      (
        wrapper.get('input[aria-label="Titre de la note"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("Racine");
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
  it("ouvre l'historique local depuis l'assistant et le referme", async () => {
    const { wrapper } = await mountVault();

    const assistant = wrapper
      .findAll(".workspace-tool")
      .find((button) => button.text() === "Assistant")!;
    await assistant.trigger("click");
    wrapper.findComponent({ name: "AiChat" }).vm.$emit("toggle-history");
    await flushPromises();

    expect(wrapper.findComponent({ name: "HistoryPanel" }).exists()).toBe(true);
    expect(wrapper.find('[aria-label="Assistant d\'écriture"]').exists()).toBe(
      false,
    );

    await wrapper
      .get('button[aria-label="Fermer l\'historique local"]')
      .trigger("click");
    expect(wrapper.findComponent({ name: "HistoryPanel" }).exists()).toBe(
      false,
    );
  });

  it("referme l'historique quand une pièce jointe ouvre l'assistant", async () => {
    const { wrapper } = await mountVault();
    const assistant = wrapper
      .findAll(".workspace-tool")
      .find((button) => button.text() === "Assistant")!;
    await assistant.trigger("click");
    wrapper.findComponent({ name: "AiChat" }).vm.$emit("toggle-history");
    await flushPromises();
    wrapper.findComponent({ name: "VaultTree" }).vm.$emit("attach", noteId);
    await flushPromises();
    expect(wrapper.findComponent({ name: "AiChat" }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: "HistoryPanel" }).exists()).toBe(
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

    await tool("Assistant").trigger("click");
    expect(wrapper.find('[aria-label="Assistant d\'écriture"]').exists()).toBe(
      true,
    );

    wrapper.findComponent({ name: "AiChat" }).vm.$emit("toggle-history");
    await flushPromises();
    expect(wrapper.findComponent({ name: "HistoryPanel" }).exists()).toBe(true);
    expect(wrapper.find('[aria-label="Assistant d\'écriture"]').exists()).toBe(
      false,
    );
  });

  it("épingle une note depuis l'arbre via le store", async () => {
    const { wrapper, vault } = await mountVault({ stubVaultTree: false });
    const spy = vi.spyOn(vault, "togglePinnedNote").mockResolvedValue();

    wrapper.findComponent({ name: "VaultTree" }).vm.$emit("pin", noteId);
    await flushPromises();

    expect(spy).toHaveBeenCalledWith(noteId);
    wrapper.unmount();
  });

  it("écrit le titre saisi dans le bandeau comme titre de la note", async () => {
    const { wrapper, vault } = await mountVault({ stubVaultTree: false });
    vault.notes.set("nested", {
      content: "# Imbriquée\n\nCorps.",
      path: "projets/sous-dossier/imbriquee.md",
      revision: 1,
    });
    const save = vi.spyOn(vault, "saveNote").mockResolvedValue({} as never);
    wrapper.findComponent({ name: "VaultTree" }).vm.$emit("select", "nested");
    await flushPromises();

    const title = wrapper.get('input[aria-label="Titre de la note"]');
    await title.setValue("Nouveau titre");
    await title.trigger("change");
    await flushPromises();

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "# Nouveau titre\n\nCorps.",
        id: "nested",
        path: "projets/sous-dossier/imbriquee.md",
      }),
    );
    expect((title.element as HTMLInputElement).value).toBe("Nouveau titre");

    await title.setValue("   ");
    await title.trigger("change");
    await flushPromises();

    expect(save).toHaveBeenCalledTimes(1);
    expect((title.element as HTMLInputElement).value).toBe("Nouveau titre");
    wrapper.unmount();
  });

  it("ne garde que l'assistant dans les outils du bandeau", async () => {
    const { wrapper } = await mountVault();

    for (const label of ["Relations", "Graphe", "Épingler", "Désépingler"]) {
      expect(
        wrapper
          .findAll(".workspace-tool")
          .some((button) => button.text() === label),
      ).toBe(false);
    }
    expect(
      wrapper
        .findAll(".workspace-tool")
        .some((button) => button.text() === "Assistant"),
    ).toBe(true);
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

  it("s’empile dans la pile d’overlays et verrouille le défilement", async () => {
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

    expect(
      wrapper.get(".attachment-preview-backdrop").attributes("style"),
    ).toContain("calc(var(--synapse-z-overlay) + 0)");
    expect(document.body.style.overflow).toBe("hidden");

    await wrapper
      .get('.attachment-preview button[aria-label="Fermer l’aperçu"]')
      .trigger("click");
    await flushPromises();

    expect(wrapper.find(".attachment-preview-backdrop").exists()).toBe(false);
    expect(document.body.style.overflow).toBe("");
    wrapper.unmount();
  });
});

describe("VaultView storage health banner", () => {
  it("n’affiche plus le bandeau storage-health dans l’en-tête du coffre", async () => {
    const { wrapper, auth } = await mountVault();
    auth.storageHealth = {
      availableBytes: 1024 * 1024 * 1024,
      lastSuccessfulBackup: null,
      pendingOperationCount: 0,
      persistent: true,
      quotaBytes: 2 * 1024 * 1024 * 1024,
      serverPendingOperationCount: 0,
      serverUsedBytes: 0,
      usageBytes: 1024 * 1024 * 1024,
    };
    await flushPromises();

    expect(wrapper.find(".storage-health").exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/MiB|disponibles|opérations en attente/);
    wrapper.unmount();
  });
});

function noteMenuItem(label: string) {
  return [
    ...document.body.querySelectorAll<HTMLButtonElement>(
      '[role="menu"][aria-label="Actions de la note"] [role="menuitem"]',
    ),
  ].find(
    (item) =>
      item
        .querySelector(".synapse-markdown-context-item-label")
        ?.textContent?.trim() === label,
  );
}

function noteMenuItemLabels() {
  return [
    ...document.body.querySelectorAll(
      '[role="menu"][aria-label="Actions de la note"] [role="menuitem"]',
    ),
  ].map((item) =>
    item
      .querySelector(".synapse-markdown-context-item-label")
      ?.textContent?.trim(),
  );
}

/** Le menu est rendu sur place dans la vue : monter la vue dans le document
 * permet de l'interroger comme les autres overlays. */
/** Remplace le presse-papiers du navigateur et rend la fonction qui restitue
 * l'état initial (jsdom n'en fournit pas). */
function stubClipboard(writeText: (text: string) => Promise<void>) {
  const hadOwnClipboard = Object.prototype.hasOwnProperty.call(
    window.navigator,
    "clipboard",
  );
  const originalClipboard = Object.getOwnPropertyDescriptor(
    window.navigator,
    "clipboard",
  );
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return () => {
    if (hadOwnClipboard && originalClipboard) {
      Object.defineProperty(window.navigator, "clipboard", originalClipboard);
    } else {
      delete (window.navigator as { clipboard?: unknown }).clipboard;
    }
  };
}

/** jsdom ne donne pas d'origine stable : on fixe celle de la page pour vérifier
 * l'adresse copiée. */
function stubLocationOrigin(origin: string) {
  const original = Object.getOwnPropertyDescriptor(window, "location");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { origin },
  });
  return () => {
    if (original) Object.defineProperty(window, "location", original);
    else delete (window as { location?: unknown }).location;
  };
}

async function mountVaultWithNoteMenu() {
  return mountVault({ attachToBody: true, stubVaultTree: false });
}

async function openNoteMenu(wrapper: VueWrapper) {
  await wrapper
    .get('[data-kind="note"]')
    .trigger("contextmenu", { clientX: 40, clientY: 60 });
  await flushPromises();
}

describe("VaultView menu contextuel de note", () => {
  afterEach(() => {
    // Le menu vit dans la vue montée dans le document : nettoyage même en cas
    // d'échec pour ne pas polluer les tests suivants.
    document.body.innerHTML = "";
  });

  it("ouvre le menu d'une note au clic droit sans changer la sélection", async () => {
    const { wrapper } = await mountVaultWithNoteMenu();
    const editor = wrapper.get('[data-test="markdown-editor"]');
    const draft = editor.text();
    await openNoteMenu(wrapper);

    const menu = document.body.querySelector(
      '[role="menu"][aria-label="Actions de la note"]',
    );
    expect(menu).not.toBeNull();
    expect(noteMenuItemLabels()).toEqual([
      "Désépingler",
      "Exporter en PDF",
      "Exporter en Markdown",
      "Copier le lien de la note",
      "Copier le wikilink",
      "Dupliquer la note",
      "Historique local",
      "Supprimer",
    ]);
    // Le clic droit ne touche pas au brouillon de la note courante.
    expect(editor.text()).toBe(draft);
    wrapper.unmount();
  });

  it("vise la note cliquée sans déplacer la note courante", async () => {
    const { wrapper, vault } = await mountVaultWithNoteMenu();
    vault.notes.set("note-2", {
      content: "# Autre note",
      path: "autre-note.md",
      revision: 1,
    });
    await flushPromises();

    const otherNote = wrapper
      .findAll('[data-kind="note"]')
      .find((row) => row.text().includes("Autre note"))!;
    await otherNote.trigger("contextmenu", { clientX: 40, clientY: 60 });
    await flushPromises();

    // Note-2 n'est pas épinglée : le menu cible bien la note cliquée…
    expect(noteMenuItemLabels()[0]).toBe("Épingler");
    // …sans changer la note courante, restée la note restaurée au montage.
    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "Note épinglée",
    );
    wrapper.unmount();
  });

  it("n'ouvre rien pour un dossier et ne montre pas les pièces jointes dans Notes", async () => {
    const { wrapper, vault } = await mountVaultWithNoteMenu();
    vault.notes.set("nested", {
      content: "# Imbriquée",
      path: "projets/imbriquee.md",
      revision: 1,
    });
    vault.attachments.set("att-1", {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      path: "attachments/photo.png",
      revision: 1,
    });
    await flushPromises();

    await wrapper.get('[data-kind="folder"]').trigger("contextmenu");
    await flushPromises();

    expect(wrapper.find('[data-kind="attachment"]').exists()).toBe(false);
    expect(vault.attachments.has("att-1")).toBe(true);
    expect(
      document.body.querySelector(
        '[role="menu"][aria-label="Actions de la note"]',
      ),
    ).toBeNull();
    wrapper.unmount();
  });

  it("bascule l'épingle depuis le menu", async () => {
    const { wrapper, vault } = await mountVaultWithNoteMenu();
    const spy = vi.spyOn(vault, "togglePinnedNote").mockResolvedValue();
    await openNoteMenu(wrapper);

    noteMenuItem("Désépingler")!.click();
    await flushPromises();

    expect(spy).toHaveBeenCalledWith(noteId);
    wrapper.unmount();
  });

  it("supprime via le flux existant depuis le menu", async () => {
    const { wrapper, vault } = await mountVaultWithNoteMenu();
    const remove = vi.spyOn(vault, "deleteNote").mockResolvedValue({} as never);
    await openNoteMenu(wrapper);

    noteMenuItem("Supprimer")!.click();
    await flushPromises();

    expect(remove).toHaveBeenCalledWith(noteId);
    wrapper.unmount();
  });

  it("copie le wikilink interne exactement au format résolu par l'application", async () => {
    const { wrapper } = await mountVaultWithNoteMenu();
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockResolvedValue();
    const restoreClipboard = stubClipboard(writeText);
    try {
      await openNoteMenu(wrapper);

      noteMenuItem("Copier le wikilink")!.click();
      await flushPromises();

      expect(writeText).toHaveBeenCalledWith("[[note-epinglee]]");
    } finally {
      restoreClipboard();
    }
    wrapper.unmount();
  });

  it("copie l'adresse de l'application qui ouvre la note", async () => {
    const { wrapper } = await mountVaultWithNoteMenu();
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockResolvedValue();
    const restoreClipboard = stubClipboard(writeText);
    const restoreLocation = stubLocationOrigin("https://synapse.local");
    try {
      await openNoteMenu(wrapper);

      noteMenuItem("Copier le lien de la note")!.click();
      await flushPromises();

      // Seul l'identifiant opaque de la note est copié : ni titre ni contenu.
      expect(writeText).toHaveBeenCalledWith(
        "https://synapse.local/vault?note=note-1",
      );
    } finally {
      restoreClipboard();
      restoreLocation();
    }
    wrapper.unmount();
  });

  it("signale un presse-papiers indisponible sans perdre la note", async () => {
    const { wrapper } = await mountVaultWithNoteMenu();
    const writeText = vi.fn().mockRejectedValue(new Error("refusé"));
    const restoreClipboard = stubClipboard(
      writeText as unknown as (text: string) => Promise<void>,
    );
    try {
      await openNoteMenu(wrapper);

      noteMenuItem("Copier le lien de la note")!.click();
      await flushPromises();

      expect(
        toasts.value.some((toast) => toast.message.includes("presse-papiers")),
      ).toBe(true);
      expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
        "Note épinglée",
      );
    } finally {
      restoreClipboard();
    }
    wrapper.unmount();
  });

  it("exporte en Markdown par un téléchargement local", async () => {
    const { wrapper } = await mountVaultWithNoteMenu();
    // jsdom n'implémente pas les blob URLs : on les simule localement.
    const createObjectURL = vi.fn((_blob: Blob) => "blob:note-export");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const createElement = vi.spyOn(document, "createElement");
    try {
      await openNoteMenu(wrapper);

      noteMenuItem("Exporter en Markdown")!.click();
      await flushPromises();

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0];
      expect(blob.type).toContain("text/markdown");
      expect(anchorClick).toHaveBeenCalledTimes(1);
      const anchor = createElement.mock.results
        .map((result) => result.value)
        .find(
          (element): element is HTMLAnchorElement =>
            element instanceof HTMLAnchorElement,
        );
      expect(anchor?.download).toBe("Note épinglée.md");
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:note-export");
    } finally {
      delete (URL as unknown as Record<string, unknown>).createObjectURL;
      delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
      anchorClick.mockRestore();
      createElement.mockRestore();
    }
    wrapper.unmount();
  });

  it("déclenche un téléchargement de PDF (aucune boîte d'impression)", async () => {
    const { downloadNotePdf } = await import("@synapse/ui");
    const { wrapper } = await mountVaultWithNoteMenu();
    await openNoteMenu(wrapper);

    noteMenuItem("Exporter en PDF")!.click();
    await flushPromises();

    expect(downloadNotePdf).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadNotePdf).mock.calls[0][0]).toEqual({
      filename: "Note épinglée.pdf",
      markdown: "---\nstatus: actif\n---\n# Note épinglée",
      title: "Note épinglée",
    });
    wrapper.unmount();
  });

  it("ouvre l'historique local existant depuis le menu", async () => {
    const { wrapper } = await mountVaultWithNoteMenu();
    await openNoteMenu(wrapper);

    noteMenuItem("Historique local")!.click();
    await flushPromises();

    expect(wrapper.find('[aria-label="Relations de la note"]').exists()).toBe(
      true,
    );
    expect(wrapper.findComponent({ name: "HistoryPanel" }).exists()).toBe(true);
    wrapper.unmount();
  });
});

describe("VaultView ouverture d'une note par lien (?note=)", () => {
  const autreNote = { content: "# Autre note", path: "projets/imbriquee.md" };

  it("ouvre la note visée par son identifiant plutôt que la note la plus récente", async () => {
    const { wrapper } = await mountVault({
      noteQuery: "note-2",
      notes: { "note-2": autreNote },
    });

    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "# Autre note",
    );
  });

  it("résout la valeur par le chemin de note, avec ou sans .md et sans tenir compte de la casse", async () => {
    for (const value of [
      "projets/imbriquee",
      "projets/imbriquee.md",
      "Projets/Imbriquee.MD",
    ]) {
      const { wrapper } = await mountVault({
        noteQuery: value,
        notes: { "note-2": autreNote },
      });

      expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
        "# Autre note",
      );
      wrapper.unmount();
    }
  });

  it("attend l'arrivée des notes avant de résoudre l'identifiant", async () => {
    const { vault, wrapper } = await mountVault({
      emptyVault: true,
      noteQuery: "note-2",
    });
    await flushPromises();

    // Coffre encore vide : ni alerte, ni note ouverte.
    expect(
      toasts.value.filter((toast) => toast.message.includes("introuvable")),
    ).toHaveLength(0);
    expect(wrapper.get('[data-test="markdown-editor"]').text()).not.toContain(
      "# Autre note",
    );

    vault.notes.set("note-2", { ...autreNote, revision: 1 });
    await flushPromises();

    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "# Autre note",
    );
  });

  it("avertit sans changer de note quand le lien ne correspond à rien", async () => {
    const { wrapper } = await mountVault({ noteQuery: "note-inconnue" });
    await flushPromises();

    expect(
      toasts.value.filter((toast) => toast.message.includes("introuvable")),
    ).toHaveLength(1);
    // La note courante (ici la plus récente restaurée) reste ouverte.
    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "# Note épinglée",
    );
  });

  it("traite chaque valeur une seule fois, même quand les notes arrivent ensuite", async () => {
    const { vault, wrapper } = await mountVault({
      noteQuery: "note-2",
      notes: { "note-2": autreNote },
    });
    await flushPromises();
    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "# Autre note",
    );
    const opensAfterMount = appShellCloseCalls.length;

    vault.notes.set("note-3", {
      content: "# Troisième note",
      path: "troisieme.md",
      revision: 1,
    });
    await flushPromises();

    // Aucune réouverture : le brouillon affiché n'est pas rechargé.
    expect(appShellCloseCalls.length).toBe(opensAfterMount);
    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "# Autre note",
    );
  });
});

describe("VaultView prompt rapide à l’assistant", () => {
  const assistantModels = [
    {
      id: "gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      reasoningLevels: [],
      serviceTiers: [],
    },
    {
      id: "gpt-5.6-luna",
      label: "GPT-5.6 Luna",
      reasoningLevels: [],
      serviceTiers: [],
    },
  ];

  function pressQuickAssistantShortcut(options: KeyboardEventInit = {}) {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        altKey: true,
        ctrlKey: true,
        key: "k",
        ...options,
      }),
    );
  }

  function connectAssistant(
    assistant: ReturnType<typeof useAssistantStore>,
  ): void {
    assistant.connected = true;
    assistant.model = "gpt-5.6-sol";
    assistant.models = assistantModels;
  }

  it("ouvre le prompt rapide au clavier sans ouvrir le panneau Assistant", async () => {
    const { wrapper } = await mountVault();
    const prompt = wrapper.getComponent(QuickAssistantPrompt);
    expect(prompt.props("open")).toBe(false);

    pressQuickAssistantShortcut();
    await flushPromises();

    expect(prompt.props("open")).toBe(true);
    expect(wrapper.find('[aria-label="Assistant d\'écriture"]').exists()).toBe(
      false,
    );

    pressQuickAssistantShortcut();
    await flushPromises();

    expect(prompt.props("open")).toBe(false);
  });

  it("reconnaît KeyK même quand le caractère produit n’est pas k", async () => {
    const { wrapper } = await mountVault();

    pressQuickAssistantShortcut({ key: "µ", code: "KeyK" });
    await flushPromises();

    expect(wrapper.getComponent(QuickAssistantPrompt).props("open")).toBe(true);
  });

  it("ignore AltGraph même si les modificateurs Ctrl et Alt sont exposés", async () => {
    const { wrapper } = await mountVault();
    pressQuickAssistantShortcut();
    await flushPromises();
    expect(wrapper.getComponent(QuickAssistantPrompt).props("open")).toBe(true);

    const event = new KeyboardEvent("keydown", {
      altKey: true,
      ctrlKey: true,
      key: "k",
    });
    vi.spyOn(event, "getModifierState").mockReturnValue(true);
    window.dispatchEvent(event);
    await flushPromises();

    expect(wrapper.getComponent(QuickAssistantPrompt).props("open")).toBe(true);
  });

  it("ferme et efface le prompt quand le coffre se verrouille", async () => {
    const { wrapper, vault } = await mountVault();
    pressQuickAssistantShortcut();
    await flushPromises();
    const prompt = wrapper.getComponent(QuickAssistantPrompt);
    await prompt.get("input").setValue("brouillon privé");

    vault.lock();
    await flushPromises();

    expect(prompt.props("open")).toBe(false);
    expect(prompt.find("input").exists()).toBe(false);
  });

  it("n’ouvre pas le prompt rapide au-dessus d’un autre dialogue modal", async () => {
    const unrelated = document.createElement("section");
    unrelated.setAttribute("role", "dialog");
    unrelated.setAttribute("aria-modal", "true");
    document.body.append(unrelated);

    const { wrapper } = await mountVault();
    pressQuickAssistantShortcut();
    await flushPromises();

    expect(wrapper.getComponent(QuickAssistantPrompt).props("open")).toBe(
      false,
    );
    unrelated.remove();
  });

  it("expose la commande de prompt rapide dans la palette", async () => {
    const { wrapper } = await mountVault();
    const palette = wrapper.findComponent({ name: "SearchPalette" });
    const commands = palette.props("commands") as {
      category?: string;
      hint?: string;
      id: string;
      label: string;
    }[];

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "Créer",
          hint: "Ctrl+Alt+K",
          id: "quick-assistant",
          label: "Prompt rapide à l’assistant",
        }),
      ]),
    );

    palette.vm.$emit("run", "quick-assistant");
    await flushPromises();

    expect(wrapper.getComponent(QuickAssistantPrompt).props("open")).toBe(true);
  });

  it("envoie le prompt avec le modèle choisi dans une nouvelle conversation", async () => {
    const { vault, wrapper } = await mountVault();
    const assistant = useAssistantStore();
    connectAssistant(assistant);
    vi.spyOn(vault, "persistAssistantConversations").mockResolvedValue();
    const saveNote = vi.spyOn(vault, "saveNote").mockResolvedValue({} as never);
    const setModel = vi.spyOn(assistant, "setModel");
    const newConversation = vi.spyOn(assistant, "newConversation");
    const send = vi.spyOn(assistant, "send").mockResolvedValue("");

    pressQuickAssistantShortcut();
    await flushPromises();
    const prompt = wrapper.getComponent(QuickAssistantPrompt);
    expect(prompt.props("activeNote")).toBe(true);
    expect(prompt.get('[role="note"]').text()).toContain(
      "texte en clair de la note actuellement ouverte",
    );
    wrapper
      .findComponent({ name: "MarkdownEditor" })
      .vm.$emit("update:modelValue", "# Note épinglée\n\nBrouillon durable");
    await prompt.get("input").setValue("Rédige un plan de journée");
    await prompt.get("select").setValue("gpt-5.6-luna");
    await prompt.get("form").trigger("submit");
    await flushPromises();

    expect(setModel).toHaveBeenCalledWith("gpt-5.6-luna");
    expect(saveNote).toHaveBeenCalledWith(
      expect.objectContaining({
        id: noteId,
        content: "# Note épinglée\n\nBrouillon durable",
      }),
    );
    expect(newConversation).toHaveBeenCalledWith(noteId);
    expect(send).toHaveBeenCalledWith("Rédige un plan de journée");
    expect(prompt.props("open")).toBe(false);
    expect(wrapper.find('[aria-label="Assistant d\'écriture"]').exists()).toBe(
      false,
    );
    // Le fil neuf ne reprend que la note active, après son enregistrement.
    expect(assistant.conversations).toHaveLength(1);
    expect(assistant.activeConversationId).toBe(assistant.conversations[0]?.id);
    expect(assistant.conversations[0]?.attachedNoteIds).toEqual([noteId]);
    expect(toasts.value.at(-1)).toMatchObject({ kind: "info" });
  });

  it("désactive l’envoi pendant la préparation asynchrone et ignore une seconde soumission", async () => {
    const { wrapper } = await mountVault();
    const assistant = useAssistantStore();
    connectAssistant(assistant);
    let resolveModel: (() => void) | undefined;
    const setModel = vi.spyOn(assistant, "setModel").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveModel = resolve;
        }),
    );

    pressQuickAssistantShortcut();
    await flushPromises();
    const prompt = wrapper.getComponent(QuickAssistantPrompt);
    await prompt.get("input").setValue("Demande synthétique");
    await prompt.get("form").trigger("submit");

    expect(setModel).toHaveBeenCalledTimes(1);
    expect(prompt.get('button[type="submit"]').attributes("disabled")).toBe("");

    await prompt.get("form").trigger("submit");
    expect(setModel).toHaveBeenCalledTimes(1);

    resolveModel?.();
    await flushPromises();
  });

  it("bloque l’envoi et garde le brouillon si sa sauvegarde durable échoue", async () => {
    const { vault, wrapper } = await mountVault();
    const assistant = useAssistantStore();
    connectAssistant(assistant);
    vi.spyOn(vault, "saveNote").mockRejectedValue(
      new Error("private storage detail"),
    );
    const send = vi.spyOn(assistant, "send");

    wrapper
      .findComponent({ name: "MarkdownEditor" })
      .vm.$emit("update:modelValue", "# SYNTHETIC PRIVATE DRAFT");
    pressQuickAssistantShortcut();
    await flushPromises();
    const prompt = wrapper.getComponent(QuickAssistantPrompt);
    await prompt.get("input").setValue("SYNTHETIC PRIVATE PROMPT");
    await prompt.get("form").trigger("submit");
    await flushPromises();

    expect(send).not.toHaveBeenCalled();
    expect(prompt.props("open")).toBe(true);
    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "SYNTHETIC PRIVATE DRAFT",
    );
    expect(JSON.stringify(toasts.value)).not.toContain(
      "SYNTHETIC PRIVATE PROMPT",
    );
    expect(JSON.stringify(toasts.value)).not.toContain(
      "SYNTHETIC PRIVATE DRAFT",
    );
    expect(JSON.stringify(toasts.value)).not.toContain(
      "private storage detail",
    );
    wrapper.unmount();
  });

  it("affiche la note produite par l’assistant en gardant le panneau fermé", async () => {
    const { vault, wrapper } = await mountVault({
      notes: { "note-2": { content: "# Note produite", path: "produite.md" } },
    });
    const assistant = useAssistantStore();
    connectAssistant(assistant);
    vi.spyOn(vault, "persistAssistantConversations").mockResolvedValue();
    vi.spyOn(assistant, "send").mockResolvedValue("note-2");

    pressQuickAssistantShortcut();
    await flushPromises();
    const prompt = wrapper.getComponent(QuickAssistantPrompt);
    await prompt.get("input").setValue("Crée une note de réunion");
    await prompt.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.get('[data-test="markdown-editor"]').text()).toContain(
      "# Note produite",
    );
    expect(wrapper.find('[aria-label="Assistant d\'écriture"]').exists()).toBe(
      false,
    );
  });

  it("n’envoie rien quand l’assistant est déconnecté", async () => {
    const { wrapper } = await mountVault();
    const assistant = useAssistantStore();
    const send = vi.spyOn(assistant, "send");

    pressQuickAssistantShortcut();
    await flushPromises();
    const prompt = wrapper.getComponent(QuickAssistantPrompt);
    await prompt.get("input").setValue("Bonjour");
    await prompt.get("form").trigger("submit");
    await flushPromises();

    expect(send).not.toHaveBeenCalled();
    expect(prompt.props("open")).toBe(true);
    expect(prompt.get('[role="status"]').text()).toContain(
      "Connectez l’assistant dans les paramètres",
    );
  });
});
