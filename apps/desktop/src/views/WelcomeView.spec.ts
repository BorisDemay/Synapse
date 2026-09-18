import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { installSynapseUi } from "@synapse/ui";

import WelcomeView from "./WelcomeView.vue";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("WelcomeView", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  async function mountWelcome() {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { component: WelcomeView, path: "/" },
        { component: { template: "<div />" }, path: "/vault" },
        { component: { template: "<div />" }, path: "/login" },
      ],
    });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(WelcomeView, {
      global: { plugins: [pinia, installSynapseUi, router] },
    });
    return { router, wrapper };
  }

  it("propose un coffre local ou un coffre en ligne existant", async () => {
    const { wrapper } = await mountWelcome();

    expect(
      wrapper.get('button[aria-label="Ouvrir un coffre local"]').text(),
    ).toContain("Coffre local");
    expect(
      wrapper
        .get('button[aria-label="Connecter un coffre en ligne existant"]')
        .text(),
    ).toContain("Coffre en ligne");
  });

  it("ouvre un dossier local puis entre dans le coffre", async () => {
    invoke
      .mockResolvedValueOnce({ name: "notes", source: "folder" })
      .mockResolvedValueOnce([]);
    const { router, wrapper } = await mountWelcome();

    await wrapper
      .get('button[aria-label="Ouvrir un coffre local"]')
      .trigger("click");
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith("open_vault");
    expect(router.currentRoute.value.path).toBe("/vault");
  });

  it("envoie vers la connexion pour un coffre en ligne existant", async () => {
    const { router, wrapper } = await mountWelcome();

    await wrapper
      .get('button[aria-label="Connecter un coffre en ligne existant"]')
      .trigger("click");
    await flushPromises();

    expect(invoke).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe("/login");
  });
});
