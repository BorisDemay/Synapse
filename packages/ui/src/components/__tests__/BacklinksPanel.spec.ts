import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import BacklinksPanel from "../BacklinksPanel.vue";

describe("BacklinksPanel", () => {
  it("permet de naviguer vers une note qui référence la note courante", async () => {
    const wrapper = mount(BacklinksPanel, {
      props: {
        backlinks: [{ id: "notes/roadmap.md", label: "Roadmap" }],
      },
    });

    await wrapper.get("button").trigger("click");

    expect(wrapper.emitted("select")?.[0]).toEqual(["notes/roadmap.md"]);
  });
});
