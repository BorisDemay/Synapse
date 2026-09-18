import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, expect, it, vi } from "vitest";
import ActivateView from "./ActivateView.vue";
afterEach(() => vi.unstubAllGlobals());
it("removes the activation token from the address and submits it only after confirmation", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/activate", component: ActivateView },
      { path: "/login", component: { template: "<div />" } },
    ],
  });
  await router.push("/activate?token=synthetic-activation");
  await router.isReady();
  const wrapper = mount(ActivateView, { global: { plugins: [router] } });
  await flushPromises();
  expect(router.currentRoute.value.fullPath).toBe("/activate");
  expect(fetcher).not.toHaveBeenCalled();
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(fetcher).toHaveBeenCalledWith(
    "/auth/activate",
    expect.objectContaining({
      body: JSON.stringify({ token: "synthetic-activation" }),
      method: "POST",
    }),
  );
  expect(wrapper.get('[role="status"]').text()).toContain("Compte activé");
  expect(wrapper.text()).not.toContain("synthetic-activation");
  wrapper.unmount();
});

it("uses the shared auth card layout with styled headings and links", () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/activate", component: ActivateView },
      { path: "/login", component: { template: "<div />" } },
    ],
  });
  const wrapper = mount(ActivateView, { global: { plugins: [router] } });

  expect(wrapper.find("h2").text()).toContain("Activer votre compte");
  expect(wrapper.get(".subtitle").text()).toContain("activation");
  const footer = wrapper.get(".form-footer");
  expect(footer.get("a").text()).toBe("Se connecter");
  wrapper.unmount();
});
