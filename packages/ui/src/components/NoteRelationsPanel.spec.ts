import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import NoteRelationsPanel from "./NoteRelationsPanel.vue";

describe("NoteRelationsPanel", () => {
  it("affiche un seul panneau à la fois et permet de changer d'onglet", async () => {
    const wrapper = mount(NoteRelationsPanel, {
      props: {
        backlinks: [],
        recoveryView: true,
        history: [
          {
            label: "Snapshot de récupération · révision 3",
            recordedAt: new Date().toISOString(),
            revision: 3,
            recoverySnapshot: true,
          },
        ],
      },
    });

    expect(wrapper.get('[role="tabpanel"]').text()).toContain(
      "Aucun lien entrant.",
    );
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain("Révision 3");

    await wrapper
      .get('[role="tab"][aria-controls="relations-history"]')
      .trigger("click");

    expect(wrapper.get('[role="tabpanel"]').text()).toContain(
      "Snapshot de récupération · révision 3",
    );
    expect(wrapper.get('[role="tabpanel"]').text()).not.toContain(
      "Aucun lien entrant.",
    );
    expect(
      wrapper
        .get('[role="tab"][aria-controls="relations-history"]')
        .attributes("aria-selected"),
    ).toBe("true");
  });

  it("conserve l’historique natif et les restore points par défaut", async () => {
    const wrapper = mount(NoteRelationsPanel, {
      props: {
        backlinks: [],
        history: [
          { label: "Révision native", recordedAt: "2026-01-01", revision: 2 },
        ],
      },
    });

    await wrapper
      .get('[role="tab"][aria-controls="relations-history"]')
      .trigger("click");

    expect(wrapper.get('[role="tabpanel"]').text()).toContain(
      "Révision native",
    );
    expect(wrapper.find('[data-action="create-restore-point"]').exists()).toBe(
      true,
    );
  });

  it("affiche les snapshots seulement en mode récupération", async () => {
    const wrapper = mount(NoteRelationsPanel, {
      props: {
        backlinks: [],
        history: [{ label: "Snapshot", revision: 4, recoverySnapshot: true }],
        recoveryView: true,
      },
    });

    await wrapper
      .get('[role="tab"][aria-controls="relations-history"]')
      .trigger("click");

    expect(wrapper.get('[role="tabpanel"]').text()).toContain("Snapshot");
    expect(wrapper.find('[data-action="create-restore-point"]').exists()).toBe(
      false,
    );
  });

  it("émet close depuis l’en-tête du panneau", async () => {
    const wrapper = mount(NoteRelationsPanel, {
      props: { backlinks: [], history: [] },
    });

    await wrapper.get('button[name="close-note-relations"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("nomme le bouton de fermeture d’après l’onglet actif, pas toujours Historique", async () => {
    const wrapper = mount(NoteRelationsPanel, {
      props: {
        backlinks: [
          {
            id: "notes/lien.md",
            label: "Note liée",
          },
        ],
        history: [],
      },
    });

    const closeButton = wrapper.get('button[name="close-note-relations"]');
    expect(closeButton.attributes("aria-label")).toBe(
      "Fermer le panneau des liens entrants",
    );

    await wrapper
      .get('[role="tab"][aria-controls="relations-history"]')
      .trigger("click");
    expect(closeButton.attributes("aria-label")).toBe(
      "Fermer le panneau Historique",
    );
  });
});
