import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import PrimeVue from "primevue/config";
import { afterEach, expect, it, vi } from "vitest";
import ActivateView from "./ActivateView.vue";

function mountActivate(router: ReturnType<typeof createRouter>) {
  return mount(ActivateView, {
    global: { plugins: [router, [PrimeVue, { unstyled: true }]] },
  });
}
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
  const wrapper = mountActivate(router);
  await flushPromises();
  expect(router.currentRoute.value.fullPath).toBe("/activate");
  expect(fetcher).not.toHaveBeenCalled();
  const activateButton = wrapper
    .findAll("button")
    .find((candidate) => candidate.text().includes("Activer le compte"));
  expect(activateButton).toBeDefined();
  await activateButton?.trigger("click");
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
  const wrapper = mountActivate(router);

  expect(wrapper.find("h2").text()).toContain("Activer votre compte");
  expect(wrapper.get(".subtitle").text()).toContain("activation");
  const footer = wrapper.get(".form-footer");
  expect(footer.get("a").text()).toBe("Se connecter");
  wrapper.unmount();
});

it("mirrors the two-column auth layout with the branding aside", () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/activate", component: ActivateView },
      { path: "/login", component: { template: "<div />" } },
    ],
  });
  const wrapper = mountActivate(router);

  const aside = wrapper.get(".auth-aside");
  expect(aside.get(".auth-brand").text()).toContain("Synapse");
  expect(aside.get("h1").text()).toContain("idées");
  expect(wrapper.get(".page-toolbar").text()).toContain("Activation");
  wrapper.unmount();
});
