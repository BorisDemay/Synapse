import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeletedItemsPanel from "./DeletedItemsPanel.vue";

const items = [
  {
    id: "note-1",
    label: "Project",
    path: "Work/Project.md",
    kind: "note" as const,
    recoverable: true,
  },
  {
    id: "missing",
    label: "Élément supprimé",
    path: "",
    kind: "note" as const,
    recoverable: false,
  },
];

const originalShow = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const originalClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);
beforeEach(() => {
  // jsdom has the element but does not implement the native dialog API.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    }),
  });
});
afterEach(() => {
  if (originalShow)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      originalShow,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose)
    Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

describe("DeletedItemsPanel", () => {
  it("explains local-history limits and offers restoration only when available", async () => {
    const wrapper = mount(DeletedItemsPanel, { props: { open: true, items } });
    await flushPromises();
    expect(wrapper.text()).toContain("cet appareil");
    expect(wrapper.text()).toContain("Work/Project.md");
    expect(wrapper.findAll("button[data-restore]")).toHaveLength(1);
    await wrapper.get("button[data-restore]").trigger("click");
    expect(wrapper.emitted("restore")).toEqual([["note-1"]]);
    expect(wrapper.text()).toContain("Historique local indisponible");
    wrapper.unmount();
  });

  it("prevents duplicate restores and announces progress/errors", async () => {
    const wrapper = mount(DeletedItemsPanel, {
      props: { open: true, items, restoring: true },
    });
    expect(
      wrapper.get("button[data-restore]").attributes("disabled"),
    ).toBeDefined();
    await wrapper.setProps({
      restoring: false,
      error: "Restauration impossible. Réessayez.",
    });
    expect(wrapper.get('[role="alert"]').text()).toContain("Réessayez");
    wrapper.unmount();
  });

  it("closes on native Escape cancellation and does not retain hidden entries", async () => {
    const wrapper = mount(DeletedItemsPanel, { props: { open: true, items } });
    await flushPromises();
    await wrapper.get("dialog").trigger("cancel");
    expect(wrapper.emitted("close")).toHaveLength(1);
    await wrapper.setProps({ open: false });
    expect(wrapper.text()).not.toContain("Work/Project.md");
    wrapper.unmount();
  });
});
