import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ToastHost from "./ToastHost.vue";
import { clearToasts, dismissToast, notify, toasts } from "./toasts";

beforeEach(() => {
  vi.useFakeTimers();
  clearToasts();
});
afterEach(() => {
  clearToasts();
  vi.useRealTimers();
});

it("stacks accessible color-coded notifications in the top-right and dismisses them", async () => {
  const wrapper = mount(ToastHost);
  notify({ kind: "success", message: "Enregistré" });
  notify({ kind: "warning", message: "Attention" });
  notify({ kind: "error", message: "Impossible" });
  await wrapper.vm.$nextTick();

  expect(wrapper.get(".toast-stack").classes()).toContain(
    "toast-stack--top-right",
  );
  expect(wrapper.get('[data-kind="success"]').attributes("role")).toBe(
    "status",
  );
  expect(wrapper.get('[data-kind="warning"]').attributes("role")).toBe(
    "status",
  );
  expect(wrapper.get('[data-kind="error"]').attributes("role")).toBe("alert");
  expect(
    wrapper.get(
      '[data-kind="success"] button[aria-label="Fermer la notification"]',
    ),
  ).toBeTruthy();

  vi.advanceTimersByTime(7000);
  await wrapper.vm.$nextTick();
  expect(wrapper.find('[data-kind="success"]').exists()).toBe(false);
  expect(wrapper.get('[data-kind="error"]').text()).toContain("Impossible");
  await wrapper
    .get('[data-kind="error"] button[aria-label="Fermer la notification"]')
    .trigger("click");
  expect(wrapper.find('[data-kind="error"]').exists()).toBe(false);
  wrapper.unmount();
});

it("supports a one-shot asynchronous undo action, and clears sensitive text", async () => {
  const undo = vi.fn().mockResolvedValue(undefined);
  const wrapper = mount(ToastHost);
  notify({
    kind: "info",
    message: "Ma note supprimée",
    action: { label: "Annuler la suppression", run: undo },
  });
  await wrapper.vm.$nextTick();
  const action = wrapper.get('[data-kind="info"] button:not([aria-label])');
  await action.trigger("click");
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  expect(undo).toHaveBeenCalledOnce();
  expect(toasts.value).toHaveLength(0);

  const id = notify({ kind: "info", message: "Autre note" });
  dismissToast(id);
  notify({ kind: "warning", message: "Chemin privé" });
  clearToasts();
  expect(toasts.value).toHaveLength(0);
  wrapper.unmount();
});
