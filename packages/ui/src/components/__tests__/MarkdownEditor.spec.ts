import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MarkdownEditor from "../MarkdownEditor.vue";

describe("MarkdownEditor", () => {
  beforeEach(() => {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enregistre une seule fois après une rafale de modifications", async () => {
    vi.useFakeTimers();
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: "" },
    });
    const content = wrapper.get('[contenteditable="true"]');

    content.element.textContent = "# Première version";
    await content.trigger("input", { inputType: "insertText" });
    content.element.textContent = "# Version finale";
    await content.trigger("input", { inputType: "insertText" });
    await vi.advanceTimersByTimeAsync(500);

    expect(wrapper.emitted("save")).toEqual([["# Version finale"]]);
  });
});
