import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { installSynapseUi } from "@synapse/ui";

import UnlockView from "./UnlockView.vue";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("UnlockView", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => {
      if (command === "open_online_vault") {
        return { name: "Notes en ligne", source: "online" };
      }
      if (command === "list_notes") {
        return [];
      }
      if (command === "unlock_vault") {
        return undefined;
      }
      if (command === "flush_sync") {
        return { conflict: null, status: "synced" };
      }
      return undefined;
    });
  });

  it("ouvre un coffre en ligne pour conserver les notes sans dossier local", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { component: UnlockView, path: "/unlock" },
        { component: { template: "<div />" }, path: "/vault" },
      ],
    });
    await router.push("/unlock");
    await router.isReady();
    const wrapper = mount(UnlockView, {
      global: { plugins: [pinia, installSynapseUi, router] },
    });

    expect(wrapper.text()).toContain("Créer votre coffre chiffré");
    expect(wrapper.get('button[type="submit"]').text()).toContain(
      "Créer le coffre chiffré",
    );

    await wrapper.get("#unlock-passphrase").setValue("phrase secrète");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(invoke).toHaveBeenCalledWith("open_online_vault");
    expect(invoke).toHaveBeenCalledWith("unlock_vault", {
      passphrase: "phrase secrète",
    });
    expect(router.currentRoute.value.path).toBe("/vault");
  });
});
