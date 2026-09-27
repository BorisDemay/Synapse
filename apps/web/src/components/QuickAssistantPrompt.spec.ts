import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetOverlayStack } from "@synapse/ui";
import QuickAssistantPrompt from "./QuickAssistantPrompt.vue";

const models = [
  { id: "model-a", label: "Model A", reasoningLevels: [], serviceTiers: [] },
  { id: "model-b", label: "Model B", reasoningLevels: [], serviceTiers: [] },
];
function mountPrompt(
  options: { connected?: boolean; model?: string; open?: boolean } = {},
): VueWrapper {
  return mount(QuickAssistantPrompt, {
    attachTo: document.body,
    props: {
      connected: options.connected ?? true,
      model: options.model ?? "model-a",
      models,
      open: options.open ?? true,
    },
  });
}
describe("QuickAssistantPrompt", () => {
  let wrapper: VueWrapper | undefined;
  beforeEach(() => {
    resetOverlayStack();
    document.body.removeAttribute("style");
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    resetOverlayStack();
    document.body.removeAttribute("style");
  });
  it("lets the user choose a model and emits the trimmed prompt", async () => {
    wrapper = mountPrompt();
    await wrapper.get("input").setValue("  Draft a plan  ");
    await wrapper.get("select").setValue("model-b");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("submit")).toEqual([
      [{ model: "model-b", prompt: "Draft a plan" }],
    ]);
  });
  it("disables submission while disconnected, busy, or empty", async () => {
    wrapper = mountPrompt({ connected: false });
    await wrapper.get("input").setValue("Request");
    expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBe(
      "",
    );
    expect(wrapper.get('[role="status"]').text()).toContain(
      "Connectez l’assistant",
    );
    await wrapper.setProps({ connected: true, busy: true });
    expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBe(
      "",
    );
  });
  it("traps focus, handles Escape through overlay stack, and restores opener focus", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    wrapper = mountPrompt({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get("input").element);
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")).toHaveLength(1);
    await wrapper.setProps({ open: false });
    await flushPromises();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
  it("erases the plaintext prompt when closed", async () => {
    wrapper = mountPrompt();
    await wrapper.get("input").setValue("synthetic private prompt");
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    expect((wrapper.get("input").element as HTMLInputElement).value).toBe("");
  });
});
