import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import HistoryPanel from "../HistoryPanel.vue";

describe("HistoryPanel", () => {
  it("shows only unexpired recovery snapshots while preserving named restore points", () => {
    const wrapper = mount(HistoryPanel, {
      props: {
        recoveryView: true,
        entries: [
          {
            revision: 3,
            label: "snapshot récent",
            recordedAt: new Date().toISOString(),
            recoverySnapshot: true,
          },
          {
            revision: 2,
            label: "snapshot expiré",
            recordedAt: new Date(
              Date.now() - 8 * 24 * 60 * 60_000,
            ).toISOString(),
            recoverySnapshot: true,
          },
          {
            revision: 4,
            label: "snapshot invalide",
            recordedAt: "not-a-date",
            recoverySnapshot: true,
          },
          { revision: 1, label: "ancienne révision" },
        ],
        restorePoints: [
          { revision: 0, label: "point nommé", recordedAt: "2026-01-01" },
        ],
      },
    });
    expect(wrapper.text()).toContain("snapshot récent");
    expect(wrapper.text()).not.toContain("snapshot expiré");
    expect(wrapper.text()).not.toContain("snapshot invalide");
    expect(wrapper.text()).not.toContain("ancienne révision");
    expect(wrapper.text()).toContain("point nommé");
    expect(wrapper.find('[data-action="create-restore-point"]').exists()).toBe(
      false,
    );
  });

  it("demande confirmation avant de restaurer une révision", async () => {
    const wrapper = mount(HistoryPanel, {
      props: {
        entries: [{ revision: 2, label: "Révision 2" }],
      },
    });

    await wrapper.get("button").trigger("click");

    expect(wrapper.get('[role="alertdialog"]').text()).toContain("Révision 2");
    expect(wrapper.emitted("restore")).toBeUndefined();

    await wrapper.get('[data-action="confirm-restore"]').trigger("click");

    expect(wrapper.emitted("restore")?.[0]).toEqual([2]);
  });
});
