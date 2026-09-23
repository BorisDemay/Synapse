import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pushOverlay, resetOverlayStack } from "../../overlay-stack";
import SearchPalette from "../SearchPalette.vue";

describe("SearchPalette", () => {
  let wrapper: ReturnType<typeof mount> | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    resetOverlayStack();
  });

  it("ouvre la recherche avec Control+K et expose les résultats", async () => {
    wrapper = mount(SearchPalette, {
      props: {
        query: "",
        results: [{ id: "notes/roadmap.md", label: "Roadmap" }],
      },
    });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe(
      "Recherche dans le coffre",
    );
    expect(wrapper.get('[role="option"]').text()).toContain("Roadmap");
  });

  it("intercepte Control+K avant que le raccourci n'atteigne l’éditeur", async () => {
    const wrapper = mount(SearchPalette, {
      attachTo: document.body,
      props: { query: "", results: [] },
    });
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    const writeLinkSyntax = vi.fn();
    editor.addEventListener("keydown", writeLinkSyntax);
    document.body.append(editor);

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "k",
    });
    editor.dispatchEvent(event);
    await wrapper.vm.$nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(writeLinkSyntax).not.toHaveBeenCalled();
    expect(wrapper.get('[role="dialog"]').isVisible()).toBe(true);
    wrapper.unmount();
    editor.remove();
  });

  it("leaves Control+Shift+K available for the editor link shortcut", async () => {
    const wrapper = mount(SearchPalette, {
      props: { query: "", results: [] },
    });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "k", shiftKey: true }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("émet la saisie et sélectionne un résultat", async () => {
    wrapper = mount(SearchPalette, {
      props: {
        query: "",
        results: [{ id: "notes/roadmap.md", label: "Roadmap" }],
      },
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }),
    );
    await wrapper.vm.$nextTick();

    await wrapper.get("input").setValue("road");
    expect(wrapper.emitted("update:query")?.at(-1)).toEqual(["road"]);

    await wrapper.get('[role="option"]').trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["notes/roadmap.md"]);
  });

  it("exécute une commande depuis la palette", async () => {
    wrapper = mount(SearchPalette, {
      props: {
        commands: [{ id: "new-note", label: "Nouvelle note" }],
        query: "",
        results: [],
      },
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }),
    );
    await wrapper.vm.$nextTick();
    await wrapper.get('[role="option"]').trigger("click");
    expect(wrapper.emitted("run")?.[0]).toEqual(["new-note"]);
  });

  it("distingue les commandes des notes avec des groupes libellés", async () => {
    wrapper = mount(SearchPalette, {
      props: {
        commands: [{ id: "new-note", label: "Nouvelle note" }],
        query: "",
        results: [
          {
            hint: "notes/roadmap.md",
            id: "notes/roadmap.md",
            label: "Roadmap",
          },
        ],
      },
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }),
    );
    await wrapper.vm.$nextTick();

    const list = wrapper.get('[role="listbox"]');
    const groups = list.findAll('[role="presentation"]');
    expect(groups.map((group) => group.text())).toEqual(["Commandes", "Notes"]);
    const options = list.findAll('[role="option"]');
    expect(options[0].text()).toContain("Nouvelle note");
    expect(options[1].text()).toContain("Roadmap");
    expect(options[1].text()).toContain("notes/roadmap.md");
  });

  it("ne vole pas le Ctrl+Shift+K de l’éditeur de liens", () => {
    wrapper = mount(SearchPalette, {
      props: { query: "", results: [] },
    });

    window.dispatchEvent(
      new KeyboardEvent("keydown", { ctrlKey: true, shiftKey: true, key: "k" }),
    );
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it("ne s’ouvre pas au-dessus d’un autre dialogue modal ouvert", async () => {
    const unrelated = document.createElement("section");
    unrelated.setAttribute("role", "dialog");
    unrelated.setAttribute("aria-modal", "true");
    document.body.append(unrelated);

    wrapper = mount(SearchPalette, {
      props: { query: "", results: [] },
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    unrelated.remove();
  });

  it("ferme avec Échap et rend le focus à l’élément d’origine", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    wrapper = mount(SearchPalette, {
      attachTo: document.body,
      props: { query: "", results: [] },
    });
    opener.focus();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }),
    );
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(document.activeElement).toBe(wrapper.get("input").element);

    wrapper.get('[role="dialog"]').element.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("s’empile dans la pile d’overlays et verrouille le défilement", async () => {
    wrapper = mount(SearchPalette, {
      attachTo: document.body,
      props: { query: "", results: [] },
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }),
    );
    await wrapper.vm.$nextTick();

    const backdrop = wrapper.get(".search-palette-backdrop");

    expect(backdrop.attributes("style")).toContain(
      "calc(var(--synapse-z-overlay) + 0)",
    );
    expect(document.body.style.overflow).toBe("hidden");

    await wrapper.get(".search-palette-backdrop").trigger("click");
    await wrapper.vm.$nextTick();

    expect(document.body.style.overflow).toBe("");
  });

  it("laisse Échap à l’overlay du dessus", async () => {
    wrapper = mount(SearchPalette, {
      attachTo: document.body,
      props: { query: "", results: [] },
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }),
    );
    await wrapper.vm.$nextTick();
    const settings = pushOverlay({ label: "paramètres", lockScroll: true });

    wrapper.get('[role="dialog"]').element.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(wrapper.emitted("close")).toBeUndefined();

    settings.release();
    wrapper.get('[role="dialog"]').element.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("piège Tab à l’intérieur de la palette", async () => {
    wrapper = mount(SearchPalette, {
      attachTo: document.body,
      props: {
        commands: [{ id: "new-note", label: "Nouvelle note" }],
        query: "",
        results: [],
      },
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }),
    );
    await wrapper.vm.$nextTick();

    const input = wrapper.get("input").element as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    // jsdom ne gère pas la navigation Tab native : on vérifie les deux
    // rebouclages du piège, depuis le premier et le dernier focusable.
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      }),
    );
    const lastOption = wrapper.findAll('[role="option"]').at(-1)!
      .element as HTMLElement;
    expect(document.activeElement).toBe(lastOption);

    lastOption.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(document.activeElement).toBe(input);
  });

  it("répète Ctrl+K : referme la palette sans écraser la requête en cours", async () => {
    wrapper = mount(SearchPalette, {
      props: { query: "", results: [] },
    });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }),
    );
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("update:query")).toBeUndefined();

    await wrapper.get("input").setValue("road");
    expect(wrapper.emitted("update:query")?.at(-1)).toEqual(["road"]);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(wrapper.emitted("update:query")?.at(-1)).toEqual([""]);
  });
});
