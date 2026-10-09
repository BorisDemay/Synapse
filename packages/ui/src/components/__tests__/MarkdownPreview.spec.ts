import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import MarkdownPreview from "../MarkdownPreview.vue";

describe("MarkdownPreview", () => {
  it("affiche le Markdown rendu dans une région libellée", () => {
    const wrapper = mount(MarkdownPreview, {
      props: { source: "# Projet" },
    });

    expect(wrapper.get('[role="region"]').attributes("aria-label")).toBe(
      "Aperçu Markdown",
    );
    expect(wrapper.get("h1").text()).toBe("Projet");
  });
});
