import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import { createUpdateCoordinator } from "../../update/coordinator";
import UpdateBanner from "../UpdateBanner.vue";

describe("UpdateBanner", () => {
  it("annonce une mise a jour prete et l'applique explicitement", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const coordinator = createUpdateCoordinator({
      apply,
      check: vi.fn().mockResolvedValue({
        commitSha: "b".repeat(40),
        publishedAt: "2026-08-31T12:00:00Z",
        releaseNotes: "Notes",
        version: "0.1.43",
      }),
    });
    const wrapper = mount(UpdateBanner, { props: { coordinator } });

    await coordinator.check();
    expect(wrapper.get('[role="status"]').text()).toContain(
      "Mise à jour prête",
    );
    expect(wrapper.text()).toContain("0.1.43");
    await wrapper.get("button").trigger("click");

    expect(apply).toHaveBeenCalledOnce();
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
