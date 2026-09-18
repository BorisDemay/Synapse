import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import HistoryPanel from "../HistoryPanel.vue";

describe("HistoryPanel", () => {
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
