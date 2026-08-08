import { createPinia } from "pinia";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.vue";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("App", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke
      .mockResolvedValueOnce({ name: "notes" })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);
  });

  it("crée un fichier markdown depuis le formulaire", async () => {
    const wrapper = mount(App, {
      global: { plugins: [createPinia()] },
    });

    await wrapper.get("button").trigger("click");
    await nextTick();
    await wrapper.get("input[name='note-path']").setValue("inbox.md");
    await wrapper.get("textarea[name='note-content']").setValue("# Inbox");
    await wrapper.get("form").trigger("submit");

    expect(invoke).toHaveBeenNthCalledWith(3, "write_note", {
      path: "inbox.md",
      content: "# Inbox",
    });
  });
});
