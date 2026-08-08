import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import SearchPalette from "../SearchPalette.vue";

describe("SearchPalette", () => {
  it("ouvre la recherche avec Control+K et expose les résultats", async () => {
    const wrapper = mount(SearchPalette, {
      props: {
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
    expect(wrapper.get('[role="option"]').text()).toBe("Roadmap");
  });
});
