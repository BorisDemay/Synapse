import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import {
  createUpdateCoordinator,
  UPDATE_COORDINATOR_KEY,
  type UpdateMetadata,
} from "../../update/coordinator";
import SettingsPanel from "../SettingsPanel.vue";

const update: UpdateMetadata = {
  commitSha: "b".repeat(40),
  publishedAt: "2026-08-31T12:00:00Z",
  releaseNotes: "Corrections de fiabilité.",
  version: "0.1.43",
};

const panelProps = { deviceSupported: false, deviceTrusted: false, open: true };

async function mountUpdateSettings(
  coordinator: ReturnType<typeof createUpdateCoordinator>,
) {
  const wrapper = mount(SettingsPanel, {
    global: { provide: { [UPDATE_COORDINATOR_KEY as symbol]: coordinator } },
    props: panelProps,
  });
  await wrapper.get('[data-settings-category="Mises à jour"]').trigger("click");
  await flushPromises();
  return wrapper;
}

function findButton(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll("button").find((button) => button.text() === label);
}

describe("SettingsPanel — mises à jour", () => {
  it("vérifie à la demande et confirme que l'application est à jour", async () => {
    const check = vi.fn().mockResolvedValue(null);
    const coordinator = createUpdateCoordinator({ apply: vi.fn(), check });
    const wrapper = await mountUpdateSettings(coordinator);

    expect(wrapper.get('[data-test="update-status"]').text()).toBe("");
    await findButton(wrapper, "Vérifier les mises à jour")!.trigger("click");
    await flushPromises();

    expect(check).toHaveBeenCalledOnce();
    expect(wrapper.get('[data-test="update-status"]').text()).toContain(
      "à jour",
    );
  });

  it("annonce la version disponible et permet de l'appliquer", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const coordinator = createUpdateCoordinator(
      { apply, check: vi.fn().mockResolvedValue(update) },
      { activationLabel: "Mettre à jour et redémarrer" },
    );
    const wrapper = await mountUpdateSettings(coordinator);

    await findButton(wrapper, "Vérifier les mises à jour")!.trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-test="update-status"]').text()).toContain(
      "0.1.43",
    );
    await findButton(wrapper, "Mettre à jour et redémarrer")!.trigger("click");
    await flushPromises();
    expect(apply).toHaveBeenCalledOnce();
  });

  it("dit clairement quand la vérification a échoué", async () => {
    const coordinator = createUpdateCoordinator({
      apply: vi.fn(),
      check: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const wrapper = await mountUpdateSettings(coordinator);

    await findButton(wrapper, "Vérifier les mises à jour")!.trigger("click");
    await flushPromises();

    const status = wrapper.get('[data-test="update-status"]').text();
    expect(status).toContain("Vérification impossible");
    expect(status).not.toContain("offline");
  });

  it("empêche de relancer une vérification déjà en cours", async () => {
    let resolveCheck: ((value: null) => void) | undefined;
    const check = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const coordinator = createUpdateCoordinator({ apply: vi.fn(), check });
    const wrapper = await mountUpdateSettings(coordinator);

    await findButton(wrapper, "Vérifier les mises à jour")!.trigger("click");
    await flushPromises();

    const button = wrapper.get('[data-test="check-updates"]');
    expect(button.attributes("disabled")).toBeDefined();
    resolveCheck?.(null);
    await flushPromises();
    expect(button.attributes("disabled")).toBeUndefined();
  });

  it("propose la catégorie Mises à jour quand l'application fournit un coordinateur", async () => {
    const coordinator = createUpdateCoordinator({
      apply: vi.fn(),
      check: vi.fn().mockResolvedValue(null),
    });
    const wrapper = await mountUpdateSettings(coordinator);

    expect(wrapper.find('[data-test="check-updates"]').exists()).toBe(true);
  });

  it("n'affiche pas la catégorie sans coordinateur", () => {
    const wrapper = mount(SettingsPanel, { props: panelProps });

    expect(
      wrapper.find('[data-settings-category="Mises à jour"]').exists(),
    ).toBe(false);
  });
});
