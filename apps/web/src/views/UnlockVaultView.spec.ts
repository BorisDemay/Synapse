import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

import { useVaultStore } from "../stores/vault";
import { useAuthStore } from "../stores/auth";
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
  listVaultIdsRejects?: boolean;
  rememberFails?: boolean;
  localMode?: boolean;
}): Promise<{
  wrapper: VueWrapper;
  router: Router;
  vault: ReturnType<typeof useVaultStore>;
}> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const vault = useVaultStore();
  useAuthStore().isLocalMode = options?.localMode ?? false;
  vi.spyOn(vault, "listVaultIds").mockImplementation(() =>
    options?.listVaultIdsRejects
      ? Promise.reject(new Error("offline"))
      : Promise.resolve(
          options?.vaultId === null ? [] : [options?.vaultId ?? "vault-1"],
        ),
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
  if (options?.rememberFails) {
    vi.spyOn(vault, "rememberCurrentDevice").mockRejectedValue(
      new Error("device wrap failed"),
    );
  } else {
    vi.spyOn(vault, "rememberCurrentDevice").mockResolvedValue();
  }
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
  await wrapper.get("#unlock-passphrase-confirm").setValue("local passphrase");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(create).toHaveBeenCalledOnce();
  expect(router.currentRoute.value.path).toBe("/vault");
  expect(localFolderStatus.error).toContain("Coffre créé");
  resetLocalFolderAdapterForTests();
});

describe("UnlockVaultView creation form", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocalFolderAdapterForTests();
  });

  it("asks for a passphrase confirmation with an unrecoverability warning at creation", async () => {
    const { wrapper } = await mountUnlock({ vaultId: null });

    expect(
      wrapper.find("#unlock-passphrase-confirm").exists(),
      "confirmation field should exist in create mode",
    ).toBe(true);
    expect(wrapper.text()).toContain("Confirmer la phrase de déchiffrement");
    expect(wrapper.text()).toContain("Phrase de déchiffrement");
    expect(wrapper.text()).toContain(
      "Synapse ne pourra ni la réinitialiser ni déchiffrer vos notes",
    );
    expect(wrapper.text()).toContain(
      "distincte de votre mot de passe de compte",
    );
  });

  it("rejects a mismatched confirmation without creating a vault", async () => {
    const { router, vault, wrapper } = await mountUnlock({ vaultId: null });
    const create = vi
      .spyOn(vault, "createAndUnlockVault")
      .mockResolvedValue("created");

    await wrapper.get("#unlock-passphrase").setValue("phrase longue et unique");
    await wrapper
      .get("#unlock-passphrase-confirm")
      .setValue("phrase différente");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(create).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe("/unlock");
    expect(wrapper.text()).toContain("ne correspondent pas");
  });

  it("creates and unlocks when the confirmation matches", async () => {
    const { router, vault, wrapper } = await mountUnlock({ vaultId: null });
    const create = vi
      .spyOn(vault, "createAndUnlockVault")
      .mockResolvedValue("created");

    await wrapper.get("#unlock-passphrase").setValue("phrase longue et unique");
    await wrapper
      .get("#unlock-passphrase-confirm")
      .setValue("phrase longue et unique");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith("phrase longue et unique");
    expect(router.currentRoute.value.path).toBe("/vault");
  });

  it("explains the account, vault and first-note steps without showing them to returning users", async () => {
    const { wrapper } = await mountUnlock({ vaultId: null });
    expect(wrapper.text()).toContain("première note");

    const returning = await mountUnlock();
    expect(returning.wrapper.text()).not.toContain("première note");
    expect(returning.wrapper.text()).not.toContain(
      "Synapse ne pourra ni la réinitialiser",
    );
  });

  it("warns about shared profiles on the trusted-device option", async () => {
    const { wrapper } = await mountUnlock();

    expect(wrapper.text()).toContain("profil partagé");
  });
});

describe("UnlockVaultView busy feedback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocalFolderAdapterForTests();
  });

  it("ignores duplicate submissions and disables the button while creating", async () => {
    const { router, vault, wrapper } = await mountUnlock({ vaultId: null });
    let resolveCreate: ((value: string) => void) | undefined;
    const create = vi.spyOn(vault, "createAndUnlockVault").mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveCreate = resolve;
        }),
    );

    await wrapper.get("#unlock-passphrase").setValue("phrase longue et unique");
    await wrapper
      .get("#unlock-passphrase-confirm")
      .setValue("phrase longue et unique");
    await wrapper.get("form").trigger("submit");
    await wrapper.get("form").trigger("submit");

    expect(create).toHaveBeenCalledOnce();
    expect(
      wrapper.get('button[type="submit"]').attributes("disabled"),
    ).toBeDefined();

    resolveCreate?.("created");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/vault");
  });

  it("ignores duplicate submissions while unlocking", async () => {
    const { vault, wrapper } = await mountUnlock();
    let resolveBytes: ((value: number[]) => void) | undefined;
    vi.spyOn(vault, "fetchEnvelopeBytes").mockImplementation(
      () =>
        new Promise<number[]>((resolve) => {
          resolveBytes = resolve;
        }),
    );

    await wrapper.get("#unlock-passphrase").setValue("local unlock passphrase");
    await wrapper.get("form").trigger("submit");
    await wrapper.get("form").trigger("submit");

    expect(vault.fetchEnvelopeBytes).toHaveBeenCalledOnce();

    resolveBytes?.([1, 2, 3]);
    await flushPromises();
  });
});

describe("UnlockVaultView trusted device save failure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocalFolderAdapterForTests();
  });

  it("stays on a success state with a Continue button when saving the device fails", async () => {
    const { router, wrapper } = await mountUnlock({
      rememberFails: true,
    });

    await wrapper.get("#unlock-passphrase").setValue("local unlock passphrase");
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/unlock");
    expect(wrapper.text()).toContain("Coffre déverrouillé");
    expect(wrapper.text()).toContain("L’appareil n’a pas pu être enregistré");

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Continuer")!
      .trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/vault");
  });
});

describe("UnlockVaultView discovery failure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocalFolderAdapterForTests();
  });

  it("offers a retry instead of switching to creation when discovery fails", async () => {
    const { vault, wrapper } = await mountUnlock({
      listVaultIdsRejects: true,
    });

    expect(wrapper.find("h2").text()).not.toBe("Créer un coffre");
    expect(wrapper.find("#unlock-passphrase").exists()).toBe(false);
    expect(wrapper.text()).toContain("Impossible de découvrir le coffre");

    vi.mocked(vault.listVaultIds).mockResolvedValue(["vault-1"]);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Réessayer")!
      .trigger("click");
    await flushPromises();

    expect(vault.listVaultIds).toHaveBeenCalledTimes(2);
    expect(wrapper.find("#unlock-passphrase").exists()).toBe(true);
    expect(wrapper.text()).toContain("Déverrouiller le coffre");
  });

  it("does not offer creating another vault while discovery is unavailable", async () => {
    const { wrapper } = await mountUnlock({ listVaultIdsRejects: true });
    expect(wrapper.text()).not.toContain("Créer un nouveau coffre");
    expect(wrapper.find("#unlock-passphrase-confirm").exists()).toBe(false);
    wrapper.unmount();
  });

  it("does not instruct local-only users to create an account", async () => {
    const { wrapper } = await mountUnlock({ vaultId: null, localMode: true });
    expect(wrapper.text()).toContain("Aucun compte ni serveur");
    expect(wrapper.text()).not.toContain("Créez votre compte Synapse");
    wrapper.unmount();
  });
});

describe("UnlockVaultView folder choice cancellation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocalFolderAdapterForTests();
  });

  it("retains the setup and states that nothing was created when the native picker is cancelled", async () => {
    installLocalFolderAdapter({
      supported: true,
      bind: async () => null,
      choose: async () => null,
      snapshot: async () => null,
      ensure: async () => null,
    });
    const { router, vault, wrapper } = await mountUnlock({ vaultId: null });
    const create = vi
      .spyOn(vault, "createAndUnlockVault")
      .mockResolvedValue("created");

    await wrapper.get("#unlock-passphrase").setValue("phrase longue et unique");
    await wrapper
      .get("#unlock-passphrase-confirm")
      .setValue("phrase longue et unique");
    await wrapper.get("select").setValue("choose");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(create).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe("/unlock");
    expect(
      (wrapper.get("#unlock-passphrase").element as HTMLInputElement).value,
    ).toBe("phrase longue et unique");
    expect(wrapper.text()).toContain("Le coffre n’a pas été créé");
  });
});
