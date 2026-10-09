import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import GraphPanel from "../GraphPanel.vue";

describe("GraphPanel", () => {
  it("only renders the supplied local graph and selects a note", async () => {
    const wrapper = mount(GraphPanel, {
      props: {
        graph: {
          edges: [{ source: "a", target: "b" }],
          nodes: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
        selectedId: "a",
      },
    });
    expect(wrapper.text()).toContain("Calculé uniquement");
    await wrapper.get("li:nth-child(2) button").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["b"]]);
  });
});
