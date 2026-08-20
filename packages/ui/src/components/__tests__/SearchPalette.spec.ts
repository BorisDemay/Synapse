import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import SearchPalette from "../SearchPalette.vue";

describe("SearchPalette", () => {
  it("ouvre la recherche avec Control+K et expose les résultats", async () => {
    const wrapper = mount(SearchPalette, {
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

  it("émet la saisie et sélectionne un résultat", async () => {
    const wrapper = mount(SearchPalette, {
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
    const wrapper = mount(SearchPalette, {
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
});
