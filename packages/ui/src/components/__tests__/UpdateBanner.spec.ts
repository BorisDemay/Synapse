import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import {
  createUpdateCoordinator,
  type UpdateMetadata,
} from "../../update/coordinator";
import UpdateBanner from "../UpdateBanner.vue";

const update: UpdateMetadata = {
  commitSha: "b".repeat(40),
  publishedAt: "2026-08-31T12:00:00Z",
  releaseNotes: "Corrections de fiabilité et nouvelle vue admin.",
  version: "0.1.43",
};

function findButton(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll("button").find((button) => button.text() === label);
}

describe("UpdateBanner", () => {
  it("annonce une mise a jour disponible, expose la note et l'applique", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const coordinator = createUpdateCoordinator(
      { apply, check: vi.fn().mockResolvedValue(update) },
      { activationLabel: "Mettre à jour" },
    );
    const wrapper = mount(UpdateBanner, { props: { coordinator } });

    await coordinator.check();

    const toast = wrapper.get('[role="status"]');
    expect(toast.text()).toContain("Une mise à jour est disponible");
    expect(toast.text()).toContain("0.1.43");
    expect(toast.text()).not.toContain("Corrections de fiabilité");

    await wrapper.get(".synapse-update-toast__secondary").trigger("click");
    expect(wrapper.text()).toContain("Corrections de fiabilité");

    await findButton(wrapper, "Mettre à jour")?.trigger("click");

    expect(apply).toHaveBeenCalledOnce();
  });

  it("affiche la progression pendant le telechargement", async () => {
    let release!: () => void;
    const prepare = vi.fn(
      (_metadata: UpdateMetadata, onProgress: (value: number) => void) =>
        new Promise<void>((resolve) => {
          onProgress(0.5);
          release = resolve;
        }),
    );
    const coordinator = createUpdateCoordinator({
      apply: vi.fn(),
      check: vi.fn().mockResolvedValue(update),
      prepare,
    });
    const wrapper = mount(UpdateBanner, { props: { coordinator } });

    const checking = coordinator.check();
    await flushPromises();

    expect(wrapper.text()).toContain("Téléchargement de la mise à jour");
    expect(wrapper.get("progress").attributes("value")).toBe("0.5");
    expect(wrapper.text()).toContain("50 %");

    release();
    await checking;
  });

  it("affiche le statut pendant l'application", async () => {
    let release!: () => void;
    const apply = vi.fn(
      (_metadata: UpdateMetadata, onStatus: (status: string) => void) => {
        onStatus("Activation de la mise à jour…");
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );
    const coordinator = createUpdateCoordinator(
      { apply, check: vi.fn().mockResolvedValue(update) },
      { activationLabel: "Mettre à jour" },
    );
    const wrapper = mount(UpdateBanner, { props: { coordinator } });

    await coordinator.check();
    await findButton(wrapper, "Mettre à jour")?.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Mise à jour en cours");
    expect(wrapper.text()).toContain("Activation de la mise à jour…");
    // The applying progress bar is indeterminate.
    expect(wrapper.get("progress").attributes("value")).toBeUndefined();

    release();
    await flushPromises();
  });

  it("propose de reessayer quand l'application echoue", async () => {
    const check = vi.fn().mockResolvedValue(update);
    const coordinator = createUpdateCoordinator({
      apply: vi.fn().mockRejectedValue(new Error("activation impossible")),
      check,
    });
    const wrapper = mount(UpdateBanner, { props: { coordinator } });

    await coordinator.check();
    await coordinator.apply();
    await flushPromises();

    expect(wrapper.text()).toContain("Échec de la mise à jour");
    expect(wrapper.text()).toContain("activation impossible");

    await findButton(wrapper, "Réessayer")?.trigger("click");
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("reste absent pendant l'edition quand une verification echoue", async () => {
    const coordinator = createUpdateCoordinator({
      apply: vi.fn(),
      check: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const wrapper = mount(UpdateBanner, { props: { coordinator } });

    await coordinator.check();

    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
});
