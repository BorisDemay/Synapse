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

    await wrapper.get(".synapse-update-toast__notes-toggle").trigger("click");
    expect(wrapper.text()).toContain("Corrections de fiabilité");

    const applyButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "Mettre à jour");
    await applyButton?.trigger("click");

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

    release();
    await checking;
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
