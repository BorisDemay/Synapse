import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import HistoryPanel from "../HistoryPanel.vue";

const localizedFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

describe("HistoryPanel", () => {
  it("demande confirmation avant de restaurer une révision", async () => {
    const wrapper = mount(HistoryPanel, {
      props: {
        entries: [{ revision: 2, label: "Snapshot", recoverySnapshot: true }],
      },
    });

    await wrapper.get("button").trigger("click");

    expect(wrapper.get('[role="alertdialog"]').text()).toContain("Snapshot");
    expect(wrapper.emitted("restore")).toBeUndefined();

    await wrapper.get('[data-action="confirm-restore"]').trigger("click");

    expect(wrapper.emitted("restore")?.[0]).toEqual([2]);
  });

  it("affiche la date de révision localisée et non le timestamp ISO brut", () => {
    const recordedAt = "2026-09-24T20:30:00.000Z";
    const wrapper = mount(HistoryPanel, {
      props: {
        entries: [
          {
            revision: 3,
            label: "Snapshot",
            recordedAt,
            recoverySnapshot: true,
          },
        ],
      },
    });

    const time = wrapper.get("time");

    expect(time.attributes("datetime")).toBe(recordedAt);
    expect(time.text()).toBe(localizedFormatter.format(new Date(recordedAt)));
    expect(time.text()).not.toContain("2026-09-24T20:30:00.000Z");
  });

  it("affiche « Date inconnue » pour une date invalide", () => {
    const wrapper = mount(HistoryPanel, {
      props: {
        entries: [
          {
            revision: 4,
            label: "Snapshot",
            recordedAt: "pas-une-date",
            recoverySnapshot: true,
          },
        ],
      },
    });

    const time = wrapper.get("time");

    expect(time.text()).toBe("Date inconnue");
    expect(time.attributes("datetime")).toBe("pas-une-date");
  });

  it("n’affiche aucune date quand la révision n’en porte pas", () => {
    const wrapper = mount(HistoryPanel, {
      props: {
        entries: [{ revision: 5, label: "Révision 5" }],
      },
    });

    expect(wrapper.find("time").exists()).toBe(false);
  });

  it("présente seulement les snapshots non expirés comme récupération locale", () => {
    const recent = new Date().toISOString();
    const expired = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString();
    const wrapper = mount(HistoryPanel, {
      props: {
        recoveryView: true,
        entries: [
          {
            revision: 8,
            label: "Snapshot",
            recordedAt: recent,
            recoverySnapshot: true,
          },
          { revision: 7, label: "Legacy", recordedAt: recent },
          {
            revision: 6,
            label: "Expiré",
            recordedAt: expired,
            recoverySnapshot: true,
          },
        ],
        restorePoints: [
          { revision: 2, label: "Avant refonte", recordedAt: expired },
        ],
      },
    });

    expect(wrapper.text()).toContain("Snapshots de récupération locaux");
    expect(wrapper.text()).toContain("Snapshot");
    expect(wrapper.text()).not.toContain("Legacy");
    expect(wrapper.text()).not.toContain("Expiré");
    expect(wrapper.text()).toContain("Points de restauration nommés");
    expect(wrapper.text()).toContain("Avant refonte");
    expect(wrapper.find('[data-action="create-restore-point"]').exists()).toBe(
      false,
    );
  });
});
