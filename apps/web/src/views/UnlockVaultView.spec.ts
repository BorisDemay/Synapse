import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

import { useVaultStore } from "../stores/vault";
import {
  installLocalFolderAdapter,
  resetLocalFolderAdapterForTests,
  localFolderStatus,
} from "../platform/local-folder";
import UnlockVaultView from "./UnlockVaultView.vue";

vi.mock("../crypto/vault-key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../crypto/vault-key")>();
  return {
    ...actual,
    parseWrappedVaultKey: () => ({
      ciphertext: [1],
      nonce: Array.from({ length: 24 }, () => 0),
      salt: Array.from({ length: 16 }, () => 1),
    }),
    unlockVaultKey: async () =>
      Uint8Array.from({ length: 32 }, (_, index) => index),
  };
});

async function mountUnlock(options?: {
  hasTrustedDevice?: boolean;
  unlockFails?: boolean;
  vaultId?: string | null;
}): Promise<{
  wrapper: VueWrapper;
  router: Router;
  vault: ReturnType<typeof useVaultStore>;
}> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const vault = useVaultStore();
  vi.spyOn(vault, "listVaultIds").mockResolvedValue(
    options?.vaultId === null ? [] : [options?.vaultId ?? "vault-1"],
  );
  vi.spyOn(vault, "hasTrustedDevice").mockResolvedValue(
    options?.hasTrustedDevice ?? false,
  );
  vi.spyOn(vault, "setHasEncryptedVault");
  if (options?.unlockFails) {
    vi.spyOn(vault, "unlockWithTrustedDevice").mockRejectedValue(
      new Error("wrap failed"),
    );
  } else {
    vi.spyOn(vault, "unlockWithTrustedDevice").mockResolvedValue(true);
  }
  vi.spyOn(vault, "rememberCurrentDevice").mockResolvedValue();
  vi.spyOn(vault, "fetchEnvelopeBytes").mockResolvedValue([1, 2, 3]);
  vi.spyOn(vault, "loadNotes").mockResolvedValue();
  vi.spyOn(vault, "unlock");

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: UnlockVaultView, path: "/unlock" },
      { component: { template: "<div />" }, path: "/vault" },
    ],
  });
  await router.push("/unlock");
  await router.isReady();
  const wrapper = mount(UnlockVaultView, {
    global: {
      plugins: [pinia, router, [PrimeVue, { unstyled: true }]],
    },
  });
  await flushPromises();
  return { router, vault, wrapper };
}

describe("UnlockVaultView trusted device", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocalFolderAdapterForTests();
  });

  it("unlocks from the browser wrap on page load when a trusted device exists", async () => {
    const { router, vault } = await mountUnlock({ hasTrustedDevice: true });

    expect(vault.unlockWithTrustedDevice).toHaveBeenCalledWith("vault-1");
    expect(router.currentRoute.value.path).toBe("/vault");
  });

  it("does not flash the forget-device page while auto-unlocking", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const vault = useVaultStore();
    let finishUnlock: ((value: boolean) => void) | undefined;
    vi.spyOn(vault, "listVaultIds").mockResolvedValue(["vault-1"]);
    vi.spyOn(vault, "hasTrustedDevice").mockResolvedValue(true);
    vi.spyOn(vault, "setHasEncryptedVault");
    vi.spyOn(vault, "unlockWithTrustedDevice").mockReturnValue(
      new Promise((resolve) => {
        finishUnlock = resolve;
      }),
    );

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { component: UnlockVaultView, path: "/unlock" },
        { component: { template: "<div />" }, path: "/vault" },
      ],
    });
    await router.push("/unlock");
    await router.isReady();
    const wrapper = mount(UnlockVaultView, {
      global: {
        plugins: [pinia, router, [PrimeVue, { unstyled: true }]],
      },
    });
    await flushPromises();

    expect(wrapper.text()).not.toContain("Oublier cet appareil");
    expect(wrapper.text()).not.toContain("Déverrouiller le coffre");
    finishUnlock?.(true);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/vault");
    wrapper.unmount();
  });

  it("does not offer forgetting this device on the unlock form", async () => {
    const { wrapper } = await mountUnlock({
      hasTrustedDevice: true,
      unlockFails: true,
    });

    expect(wrapper.text()).toContain("Déverrouiller le coffre");
    expect(wrapper.text()).not.toContain("Oublier cet appareil");
  });

  it("saves the browser wrap during passphrase unlock when requested", async () => {
    const { router, vault, wrapper } = await mountUnlock();

    await wrapper.get("#unlock-passphrase").setValue("local unlock passphrase");
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(vault.rememberCurrentDevice).toHaveBeenCalledOnce();
    expect(router.currentRoute.value.path).toBe("/vault");
  });
});

it("retains the created vault when folder setup fails and enters the vault for recovery", async () => {
  installLocalFolderAdapter({
    supported: true,
    bind: async () => null,
    choose: async () => null,
    snapshot: async () => null,
    ensure: async () => {
      throw new Error("not empty");
    },
  });
  const { router, vault, wrapper } = await mountUnlock({ vaultId: null });
  const create = vi
    .spyOn(vault, "createAndUnlockVault")
    .mockImplementation(async () => {
      vault.currentVaultId = "created";
      vault.isUnlocked = true;
      return "created";
    });
  await wrapper.get("#unlock-passphrase").setValue("local passphrase");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(create).toHaveBeenCalledOnce();
  expect(router.currentRoute.value.path).toBe("/vault");
  expect(localFolderStatus.error).toContain("Coffre créé");
  resetLocalFolderAdapterForTests();
});
