import { readFileSync } from "node:fs";

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
    toolbar?: Array<
      string | { name: string; hotkey?: string; toolbar?: Array<string> }
    >;
    value?: string;
  };

  let options: Options | undefined;
  let root: HTMLElement | undefined;
  let autoAfter = true;
  const instance = {
    deleteValue: vi.fn(),
    destroy: vi.fn(),
    focus: vi.fn(),
    getCurrentMode: vi.fn(() => options?.mode ?? "ir"),
    getSelection: vi.fn(() => ""),
    getValue: vi.fn(() => options?.value ?? ""),
    insertValue: vi.fn(),
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
          <button data-type="link" aria-label="Lien"></button>
        </div>
        <div class="vditor-toolbar__item">
          <button data-type="table" aria-label="Tableau"></button>
        </div>
        <div class="vditor-toolbar__item">
          <button data-type="more" aria-label="Plus"></button>
        </div>
        <div class="vditor-toolbar__item">
          <button data-type="undo"></button>
          <button data-type="redo"></button>
          <button data-type="outdent"></button>
          <button data-type="indent"></button>
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
    if (autoAfter) {
      nextOptions.after?.();
    }
    return instance;
  });

  return {
    Constructor,
    instance,
    options: () => options,
    reset() {
      options = undefined;
      root = undefined;
      autoAfter = true;
      Constructor.mockClear();
      Object.values(instance).forEach((value) => {
        if (typeof value === "function") {
          value.mockClear();
        }
      });
    },
    root: () => root,
    deferAfter() {
      autoAfter = false;
    },
    flushAfter() {
      autoAfter = true;
      options?.after?.();
    },
  };
});

vi.mock("vditor", () => ({ default: vditorMock.Constructor }));

function menuNode() {
  return document.body.querySelector<HTMLElement>(
    '[role="menu"][aria-label="Outils Markdown"]',
  );
}

function submenuNode(label: string) {
  return document.body.querySelector<HTMLElement>(
    `[role="menu"][aria-label="${label}"]`,
  );
}

function menuItems(scope: ParentNode = document.body) {
  return [...scope.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}

async function openSubmenu(label: string) {
  menuItems()
    .find((item) => item.textContent?.trim() === label)
    ?.dispatchEvent(new Event("pointerenter", { bubbles: true }));
}

describe("MarkdownEditor", () => {
  it("does not override the plain-text mode button's themed background", () => {
    const source = readFileSync("src/components/MarkdownEditor.vue", "utf8");

    expect(source).not.toMatch(
      /\.markdown-editor-mode button:last-child\s*\{[^}]*background\s*:/s,
    );
  });

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

  it("keeps Vditor command buttons mounted but hidden from users", () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: "" } });
    const toolbar = wrapper.get(".vditor-toolbar");
    expect(toolbar.attributes("aria-hidden")).toBe("true");
    expect(toolbar.attributes("role")).toBeUndefined();
    expect(toolbar.get('button[data-type="bold"]').attributes("tabindex")).toBe(
      "-1",
    );
    wrapper.unmount();
  });

  it("reserves Ctrl+K for global search by moving insert-link to Ctrl+Shift+K", () => {
    mount(MarkdownEditor, { props: { modelValue: "" } });

    const toolbar = vditorMock.options()?.toolbar ?? [];
    const link = toolbar.find(
      (item): item is { name: string; hotkey: string } =>
        typeof item !== "string" && item.name === "link",
    );
    expect(link).toEqual({ name: "link", hotkey: "⇧⌘K" });
    expect(
      toolbar.some((item) => typeof item !== "string" && item.hotkey === "⌘K"),
    ).toBe(false);
  });

  it("retains Vditor commands and hotkeys in the hidden engine toolbar", () => {
    mount(MarkdownEditor, { props: { modelValue: "" } });

    const toolbar = vditorMock.options()?.toolbar ?? [];
    expect(
      toolbar.map((item) => (typeof item === "string" ? item : item.name)),
    ).toEqual([
      "headings",
      "bold",
      "italic",
      "strike",
      "link",
      "list",
      "quote",
      "|",
      "undo",
      "redo",
      "|",
      "more",
      "edit-mode",
    ]);

    const overflow = toolbar.find(
      (item): item is { name: string; toolbar: Array<string> } =>
        typeof item !== "string" && item.name === "more",
    );
    expect(overflow?.toolbar).toEqual([
      "emoji",
      "|",
      "ordered-list",
      "check",
      "outdent",
      "indent",
      "|",
      "code",
      "inline-code",
      "|",
      "line",
      "table",
    ]);
  });

  it("exposes focus() targeting the writing area once ready", () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: "" } });

    wrapper.vm.focus();

    expect(vditorMock.instance.focus).toHaveBeenCalledOnce();
  });

  it("defers focus() until the engine signals readiness", () => {
    vditorMock.deferAfter();
    const wrapper = mount(MarkdownEditor, { props: { modelValue: "" } });

    wrapper.vm.focus();
    expect(vditorMock.instance.focus).not.toHaveBeenCalled();

    vditorMock.flushAfter();
    expect(vditorMock.instance.focus).toHaveBeenCalledOnce();
  });

  it("keeps table-specific actions out of the hidden engine toolbar", () => {
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

  it("cancels the old debounce when a different note replaces the editor value", async () => {
    vi.useFakeTimers();
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: "old note" },
    });
    vditorMock.options()?.input?.("old unsaved draft");
    await wrapper.setProps({ modelValue: "different note" });
    await vi.advanceTimersByTimeAsync(500);
    expect(wrapper.emitted("save")).toBeUndefined();
    wrapper.unmount();
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

    const labels = menuItems()
      .map((item) =>
        item
          .querySelector<HTMLSpanElement>(
            ".synapse-markdown-context-item-label",
          )
          ?.textContent?.trim(),
      )
      .filter(Boolean) as string[];
    expect(menuNode()?.getAttribute("aria-label")).toBe("Outils Markdown");
    expect(labels).toEqual(
      expect.arrayContaining([
        "Ajouter un lien",
        "Formater",
        "Paragraphe",
        "Insérer",
        "Tout sélectionner",
      ]),
    );
    expect(labels).not.toContain("Gras");
    expect(labels).not.toContain("Titre 1");
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
    await openSubmenu("Formater");
    await wrapper.vm.$nextTick();
    menuItems(submenuNode("Formater")!)
      .find((item) => item.textContent?.trim() === "Gras")
      ?.click();
    await wrapper.vm.$nextTick();

    expect(click).toHaveBeenCalledOnce();
    expect(menuNode()).toBeNull();
    wrapper.unmount();
  });

  it.each([
    { type: "undo", label: "Annuler" },
    { type: "redo", label: "Rétablir" },
    { type: "outdent", label: "Réduire le retrait", submenu: "Paragraphe" },
    { type: "indent", label: "Augmenter le retrait", submenu: "Paragraphe" },
  ])(
    "dispatches $label through the hidden Vditor command button",
    async ({ type, label, submenu }) => {
      const wrapper = mount(MarkdownEditor, {
        attachTo: document.body,
        props: { modelValue: "" },
      });
      const button = wrapper.get(`.vditor-toolbar button[data-type="${type}"]`)
        .element as HTMLButtonElement;
      const click = vi.spyOn(button, "click");
      await wrapper.get('[contenteditable="true"]').trigger("contextmenu");
      await wrapper.vm.$nextTick();
      if (submenu) {
        await openSubmenu(submenu);
        await wrapper.vm.$nextTick();
      }
      menuItems(submenu ? submenuNode(submenu)! : menuNode()!)
        .find((item) => item.textContent?.trim() === label)
        ?.click();
      expect(click).toHaveBeenCalledOnce();
      wrapper.unmount();
    },
  );

  it("routes Bloc de code to Vditor's internal code command", async () => {
    const wrapper = mount(MarkdownEditor, {
      attachTo: document.body,
      props: { modelValue: "" },
    });
    const code = document.createElement("button");
    code.dataset.type = "code";
    wrapper.get(".vditor-toolbar").element.append(code);
    const click = vi.spyOn(code, "click");

    await wrapper.get('[contenteditable="true"]').trigger("contextmenu");
    await wrapper.vm.$nextTick();
    await openSubmenu("Insérer");
    await wrapper.vm.$nextTick();
    menuItems(submenuNode("Insérer")!)
      .find((item) => item.textContent?.trim() === "Bloc de code")
      ?.click();
    expect(click).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("inserts a local emoji from the right-click menu", async () => {
    const wrapper = mount(MarkdownEditor, {
      attachTo: document.body,
      props: { modelValue: "" },
    });
    const editable = wrapper.get('.vditor-ir [contenteditable="true"]')
      .element as HTMLElement;
    editable.textContent = "abc";
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    await wrapper.get('[contenteditable="true"]').trigger("contextmenu");
    await wrapper.vm.$nextTick();
    await openSubmenu("Émojis");
    await wrapper.vm.$nextTick();
    menuItems(submenuNode("Émojis")!)
      .find((item) => item.textContent?.includes("😄 Sourire"))
      ?.click();
    expect(vditorMock.instance.insertValue).toHaveBeenCalledWith("😄");
    wrapper.unmount();
  });

  it("switches editing mode from the right-click menu", async () => {
    const wrapper = mount(MarkdownEditor, {
      attachTo: document.body,
      props: { modelValue: "" },
    });
    const source = wrapper.get('.vditor-toolbar button[data-mode="sv"]')
      .element as HTMLButtonElement;
    const click = vi.spyOn(source, "click");
    await wrapper.get('[contenteditable="true"]').trigger("contextmenu");
    await wrapper.vm.$nextTick();
    await openSubmenu("Mode d’édition");
    await wrapper.vm.$nextTick();
    menuItems(submenuNode("Mode d’édition")!)
      .find((item) => item.textContent?.trim() === "Texte brut")
      ?.click();
    expect(click).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem("synapse-ui-editor-mode")).toBe("sv");
    wrapper.unmount();
  });

  it("inserts a footnote with its definition from the Insérer submenu", async () => {
    const wrapper = mount(MarkdownEditor, {
      attachTo: document.body,
      props: { modelValue: "Corps" },
    });

    await wrapper.get('[contenteditable="true"]').trigger("contextmenu");
    await wrapper.vm.$nextTick();
    await openSubmenu("Insérer");
    await wrapper.vm.$nextTick();
    menuItems(submenuNode("Insérer")!)
      .find((item) => item.textContent?.trim() === "Note de bas de page")
      ?.click();
    await wrapper.vm.$nextTick();

    expect(vditorMock.instance.insertValue).toHaveBeenCalledWith(
      "[^1]\n\n[^1]: ",
    );
    wrapper.unmount();
  });

  it("wraps the selection in a comment from the Formater submenu", async () => {
    const wrapper = mount(MarkdownEditor, {
      attachTo: document.body,
      props: { modelValue: "" },
    });
    vditorMock.instance.getSelection.mockReturnValue("à garder");

    await wrapper.get('[contenteditable="true"]').trigger("contextmenu");
    await wrapper.vm.$nextTick();
    await openSubmenu("Formater");
    await wrapper.vm.$nextTick();
    menuItems(submenuNode("Formater")!)
      .find((item) => item.textContent?.trim() === "Commentaire")
      ?.click();
    await wrapper.vm.$nextTick();

    expect(vditorMock.instance.deleteValue).toHaveBeenCalled();
    expect(vditorMock.instance.insertValue).toHaveBeenCalledWith(
      "%%à garder%%",
    );
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

  it("uses Control+Shift+K to insert a link only from the editor writing area", async () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: "" } });
    const link = wrapper.get('.vditor-toolbar button[data-type="link"]')
      .element as HTMLButtonElement;
    const click = vi.spyOn(link, "click");

    await wrapper.get('[contenteditable="true"]').trigger("keydown", {
      ctrlKey: true,
      key: "K",
      shiftKey: true,
    });

    expect(click).toHaveBeenCalledOnce();
  });

  it("exposes focus that places the caret in the active writing area", () => {
    const wrapper = mount(MarkdownEditor, {
      attachTo: document.body,
      props: { modelValue: "" },
    });
    const editable = wrapper.get('.vditor-ir [contenteditable="true"]')
      .element as HTMLElement;
    editable.append("écrire ici");
    const focus = vi.spyOn(editable, "focus");

    (wrapper.vm as unknown as { focus: () => void }).focus();

    expect(focus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(editable);
    expect(window.getSelection()?.anchorNode).toBe(editable);
    expect(window.getSelection()?.anchorOffset).toBe(
      editable.childNodes.length,
    );
    wrapper.unmount();
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
    await openSubmenu("Tableau");
    await wrapper.vm.$nextTick();

    expect(
      menuItems(submenuNode("Tableau")!).map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(
      expect.arrayContaining([
        "Insérer une ligne en dessous",
        "Supprimer la ligne",
      ]),
    );
    wrapper.unmount();
  });
});
