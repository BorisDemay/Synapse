import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { installSynapseUi } from "@synapse/ui";

import { useVaultStore } from "../stores/vault";
import VaultView from "./VaultView.vue";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("VaultView", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("returns focus to the settings trigger after the dialog closes", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useVaultStore().vaultName = "notes";
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ component: VaultView, path: "/vault" }],
    });
    await router.push("/vault");
    await router.isReady();
    const wrapper = mount(VaultView, {
      attachTo: document.body,
      global: {
        plugins: [pinia, installSynapseUi, router],
        stubs: { MarkdownEditor: true },
      },
    });
    const settings = wrapper.get('[aria-label="Ouvrir les paramètres"]');

    await settings.trigger("click");
    await wrapper.get('[aria-label="Fermer les paramètres"]').trigger("click");
    await flushPromises();

    expect(document.activeElement).toBe(settings.element);
  });
});
