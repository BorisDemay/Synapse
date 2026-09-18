import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { installSynapseUi } from "@synapse/ui";

import { useVaultStore } from "./stores/vault";
import VaultView from "./views/VaultView.vue";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("VaultView", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => {
      if (command === "open_vault") {
        return { name: "notes", source: "folder" };
      }
      if (command === "list_notes") {
        return [];
      }
      if (command === "save_note") {
        return { hash: "ab".repeat(32), path: "inbox.md" };
      }
      return undefined;
    });
  });

  it("crée un fichier markdown depuis l’éditeur local", async () => {
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
      global: {
        plugins: [pinia, installSynapseUi, router],
        stubs: {
          MarkdownEditor: {
            props: ["modelValue"],
            template:
              "<textarea :value='modelValue' @input=\"$emit('update:modelValue', $event.target.value)\" @change=\"$emit('save', $event.target.value)\" />",
          },
        },
      },
    });

    await wrapper.get('[aria-label="Nouvelle note"]').trigger("click");
    const editor = wrapper.get("textarea");
    await editor.setValue("# Inbox");
    await editor.trigger("change");
    await nextTick();

    expect(invoke).toHaveBeenCalledWith(
      "save_note",
      expect.objectContaining({
        content: "# Inbox",
        path: expect.stringMatching(/\.md$/),
      }),
    );
  });
});
