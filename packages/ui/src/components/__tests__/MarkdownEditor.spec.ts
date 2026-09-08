import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEditorModeState } from "../../editor-mode";
import MarkdownEditor from "../MarkdownEditor.vue";

const vditorMock = vi.hoisted(() => {
  type Options = {
    after?: () => void;
    cache?: { enable?: boolean };
    cdn?: string;
    image?: { isPreview?: boolean };
    hint?: {
      emojiPath?: string;
      extend?: Array<{
        hint?: (value: string) => Array<{ html: string; value: string }>;
        key: string;
      }>;
    };
    input?: (value: string) => void;
    link?: { isOpen?: boolean };
    mode?: string;
    preview?: {
      markdown?: { sanitize?: boolean };
      render?: { media?: { enable?: boolean } };
    };
    tab?: string;
    toolbar?: Array<string | { name: string }>;
    value?: string;
  };

  let options: Options | undefined;
  let root: HTMLElement | undefined;
  const instance = {
    destroy: vi.fn(),
    getCurrentMode: vi.fn(() => options?.mode ?? "ir"),
    getValue: vi.fn(() => options?.value ?? ""),
    setTheme: vi.fn(),
    setValue: vi.fn(),
  };
  const Constructor = vi.fn(function (
    this: unknown,
    nextRoot: HTMLElement,
    nextOptions: Options,
  ) {
    root = nextRoot;
    options = nextOptions;
    nextRoot.innerHTML = `
      <div class="vditor-toolbar">
        <div class="vditor-toolbar__item">
          <button data-type="emoji" aria-label="Émojis"></button>
        </div>
        <div class="vditor-toolbar__item">
          <button data-type="headings" aria-label="Titres"></button>
          <button data-tag="h1" data-value="# ">Titre 1</button>
          <button data-tag="h2" data-value="## ">Titre 2</button>
        </div>
        <div class="vditor-toolbar__item">
          <button data-type="bold" aria-label="Gras"></button>
        </div>
        <div class="vditor-toolbar__item">
          <button data-type="table" aria-label="Tableau"></button>
        </div>
        <div class="vditor-toolbar__item synapse-edit-mode-host">
          <button data-type="edit-mode" aria-label="Mode"></button>
          <button data-mode="ir">Markdown</button>
          <button data-mode="sv">Texte brut</button>
        </div>
      </div>
      <div class="vditor-content">
        <div class="vditor-sv" contenteditable="true" style="display:none"></div>
        <div class="vditor-ir">
          <div contenteditable="true"></div>
        </div>
      </div>
    `;
    nextOptions.after?.();
    return instance;
  });

  return {
    Constructor,
    instance,
    options: () => options,
    reset() {
      options = undefined;
      root = undefined;
      Constructor.mockClear();
      Object.values(instance).forEach((mock) => mock.mockClear());
    },
    root: () => root,
  };
});

vi.mock("vditor", () => ({ default: vditorMock.Constructor }));

function menuNode() {
  return document.body.querySelector<HTMLElement>('[role="menu"]');
}

function menuItems() {
  return [
    ...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ];
}

describe("MarkdownEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    resetEditorModeState();
    vditorMock.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("labels only the active editor when hidden source mode comes first in the DOM", () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: "hello" } });
    expect(
      wrapper
        .get('.vditor-ir [contenteditable="true"]')
        .attributes("aria-label"),
    ).toBe("Éditeur Markdown");
    expect(wrapper.get(".vditor-sv").attributes("aria-label")).toBeUndefined();
  });

  it("uses complete instant rendering without persistent or remote content", () => {
    mount(MarkdownEditor, {
      props: { modelValue: "# Titre\n\n- Élément" },
    });

    const options = vditorMock.options();
    expect(options).toBeDefined();
    expect(options).toMatchObject({
      cache: { enable: false },
      image: { isPreview: false },
      link: { isOpen: false },
      mode: "ir",
      lang: "fr_FR",
      undoDelay: 80,
      preview: {
        markdown: { sanitize: true },
        render: { media: { enable: false } },
      },
      tab: "    ",
      value: "# Titre\n\n- Élément",
    });
    expect(new URL(options?.cdn ?? "").origin).toBe(window.location.origin);
    expect(options?.toolbar).not.toContain("upload");
    expect(options?.toolbar).not.toContain("record");
    const editable = vditorMock
      .root()
      ?.querySelector('.vditor-ir [contenteditable="true"]');
    expect(editable?.getAttribute("aria-label")).toBe("Éditeur Markdown");
    expect(editable?.getAttribute("lang")).toBe("fr");
  });

  it("offers escaped, local-only completions for wikilinks", () => {
    mount(MarkdownEditor, {
      props: {
        modelValue: "",
        wikilinkSuggestions: [
          { label: "Feuille de route", path: "projets/roadmap.md" },
          { label: "<script>", path: "notes/sure.md" },
        ],
      },
    });

    const completion = vditorMock
      .options()
      ?.hint?.extend?.find((item) => item.key === "[[")
      ?.hint?.("route");

    expect(completion).toEqual([
      {
        html: "Feuille de route <small>projets/roadmap.md</small>",
        value: "[[projets/roadmap]]",
      },
    ]);
    expect(
      vditorMock
        .options()
        ?.hint?.extend?.find((item) => item.key === "[[")
        ?.hint?.("sure"),
    ).toEqual([
      {
        html: "&lt;script&gt; <small>notes/sure.md</small>",
        value: "[[notes/sure]]",
      },
    ]);
  });

  it("shows explicit French labels in the formatting toolbar", () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: "" },
    });

    expect(wrapper.get('.vditor-toolbar button[data-type="bold"]').text()).toBe(
      "Gras",
    );
    expect(
      wrapper.get(".synapse-toolbar-label").attributes("aria-hidden"),
    ).toBe("true");
  });

  it("marks the formatting toolbar so it can shrink and stay centered", () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: "" },
    });

    const toolbar = wrapper.get(".vditor-toolbar");
    expect(toolbar.classes()).toContain("synapse-toolbar");
    expect(toolbar.attributes("role")).toBe("toolbar");
  });

  it("keeps table actions out of the formatting toolbar", () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: "" },
    });

    const names = (vditorMock.options()?.toolbar ?? []).flatMap((item) =>
      typeof item === "string" ? [item] : [item.name],
    );

    expect(names).not.toEqual(
      expect.arrayContaining([
        "synapse-table-row-add",
        "synapse-table-row-delete",
        "synapse-table-column-add",
        "synapse-table-column-delete",
      ]),
    );
    expect(wrapper.find(".synapse-table-controls").exists()).toBe(false);
    expect(names).toContain("edit-mode");
  });

  it("emits each Markdown update and saves once after a typing burst", async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: "" },
    });
    const input = vditorMock.options()?.input;

    input?.("- premier");
    input?.("- premier\n- second");
    await vi.advanceTimersByTimeAsync(500);

    expect(wrapper.emitted("update:modelValue")).toEqual([
      ["- premier"],
      ["- premier\n- second"],
    ]);
    expect(wrapper.emitted("save")).toEqual([["- premier\n- second"]]);
  });

  it("updates an open editor when another note becomes active", async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: "# Première" },
    });

    await wrapper.setProps({ modelValue: "# Deuxième" });

    expect(vditorMock.instance.setValue).toHaveBeenCalledWith(
      "# Deuxième",
      true,
    );
  });

  it("emits dropped and pasted files for vault attachments", async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: "" },
    });
    const file = new File(["png"], "photo.png", { type: "image/png" });
    const data = {
      files: [file],
    } as unknown as DataTransfer;

    await wrapper.get(".markdown-editor").trigger("paste", {
      clipboardData: data,
    });
    expect(wrapper.emitted("attach-files")?.[0]).toEqual([[file]]);
  });

  it("rewrites attachment paths to blob URLs", async () => {
    const wrapper = mount(MarkdownEditor, {
      props: {
        attachmentUrls: { "attachments/photo.png": "blob:http://local/photo" },
        modelValue: "![photo](attachments/photo.png)",
      },
    });
    const image = document.createElement("img");
    image.setAttribute("src", "attachments/photo.png");
    vditorMock.root()?.append(image);
    await wrapper.setProps({
      attachmentUrls: { "attachments/photo.png": "blob:http://local/photo" },
    });

    expect(image.getAttribute("src")).toBe("blob:http://local/photo");
  });

  it("destroys the editor and cancels pending saves on unmount", () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: "" },
    });
    vditorMock.options()?.input?.("contenu non enregistré");

    wrapper.unmount();
    vi.runAllTimers();

    expect(vditorMock.instance.destroy).toHaveBeenCalledOnce();
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("opens a context menu of editor tools on right-click in the writing area", async () => {
    const wrapper = mount(MarkdownEditor, {
      attachTo: document.body,
      props: { modelValue: "" },
    });

    await wrapper
      .get('[contenteditable="true"]')
      .trigger("contextmenu", { clientX: 32, clientY: 64 });
    await wrapper.vm.$nextTick();

    const labels = menuItems().map((item) => item.textContent?.trim());
    expect(menuNode()?.getAttribute("aria-label")).toBe("Outils Markdown");
    expect(labels).toEqual(
      expect.arrayContaining(["Gras", "Titre 1", "Tableau", "Émojis"]),
    );
    wrapper.unmount();
  });

  it("applies toolbar commands from the context menu", async () => {
    const wrapper = mount(MarkdownEditor, {
      attachTo: document.body,
      props: { modelValue: "" },
    });
    const bold = wrapper.get('.vditor-toolbar button[data-type="bold"]')
      .element as HTMLButtonElement;
    const click = vi.spyOn(bold, "click");

    await wrapper.get('[contenteditable="true"]').trigger("contextmenu");
    await wrapper.vm.$nextTick();
    menuItems()
      .find((item) => item.textContent?.trim() === "Gras")
      ?.click();
    await wrapper.vm.$nextTick();

    expect(click).toHaveBeenCalledOnce();
    expect(menuNode()).toBeNull();
    wrapper.unmount();
  });

  it("closes the context menu with Escape", async () => {
    const wrapper = mount(MarkdownEditor, {
      attachTo: document.body,
      props: { modelValue: "" },
    });

    await wrapper.get('[contenteditable="true"]').trigger("contextmenu");
    await wrapper.vm.$nextTick();
    expect(menuNode()).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();

    expect(menuNode()).toBeNull();
    wrapper.unmount();
  });

  it("closes the context menu on a click outside", async () => {
    const wrapper = mount(MarkdownEditor, {
      attachTo: document.body,
      props: { modelValue: "" },
    });

    await wrapper.get('[contenteditable="true"]').trigger("contextmenu");
    await wrapper.vm.$nextTick();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(menuNode()).toBeNull();
    wrapper.unmount();
  });

  it("exposes a visible Markdown / raw toggle that uses Vditor source mode", async () => {
    const wrapper = mount(MarkdownEditor, {
      attachTo: document.body,
      props: { modelValue: "" },
    });
    const source = wrapper.get('.vditor-toolbar button[data-mode="sv"]')
      .element as HTMLButtonElement;
    const click = vi.spyOn(source, "click");
    const group = wrapper.get('[aria-label="Mode d\'édition"]');

    expect(group.get("button[aria-pressed='true']").text()).toBe("Markdown");

    await group.get("button").trigger("click"); // first is Markdown, already pressed
    await group.findAll("button")[1]?.trigger("click");

    expect(click).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem("synapse-ui-editor-mode")).toBe("sv");
    expect(group.get("button[aria-pressed='true']").text()).toBe("Texte brut");
  });

  it("starts Vditor in source mode when that preference is saved", () => {
    window.localStorage.setItem("synapse-ui-editor-mode", "sv");
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: "" },
    });

    expect(vditorMock.options()?.mode).toBe("sv");
    expect(
      wrapper
        .get('[aria-label="Mode d\'édition"]')
        .get("button[aria-pressed='true']")
        .text(),
    ).toBe("Texte brut");
  });

  it("includes table actions in the context menu when the caret is in a cell", async () => {
    const wrapper = mount(MarkdownEditor, {
      attachTo: document.body,
      props: { modelValue: "" },
    });
    const cell = document.createElement("td");
    vditorMock.root()?.querySelector(".vditor-ir")?.append(cell);

    await wrapper.get("td").trigger("contextmenu");
    await wrapper.vm.$nextTick();

    expect(menuItems().map((item) => item.textContent?.trim())).toEqual(
      expect.arrayContaining(["Gras", "Insérer une ligne en dessous"]),
    );
    wrapper.unmount();
  });
});
