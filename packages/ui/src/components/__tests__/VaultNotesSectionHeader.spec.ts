import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import VaultNotesSectionHeader from "../VaultNotesSectionHeader.vue";

describe("VaultNotesSectionHeader", () => {
  it("shows Notes with a right-aligned clearly labelled new-note action", () => {
    const wrapper = mount(VaultNotesSectionHeader);

    expect(wrapper.text()).toContain("Notes");
    expect(wrapper.find(".vault-notes-section-title").text()).toBe("Notes");
    const newNote = wrapper.get('[aria-label="Nouvelle note"]');
    expect(newNote.classes()).toContain("vault-notes-new-button");
    expect(newNote.text()).toContain("Nouvelle note");
  });

  it("emits new-note when the plus action is clicked", async () => {
    const wrapper = mount(VaultNotesSectionHeader);

    await wrapper.get('[aria-label="Nouvelle note"]').trigger("click");

    expect(wrapper.emitted("new-note")).toHaveLength(1);
  });

  it("keeps the Notes title visible in compact mode", () => {
    const wrapper = mount(VaultNotesSectionHeader, {
      props: { compact: true },
    });

    expect(wrapper.find(".vault-notes-section-title").exists()).toBe(true);
    expect(wrapper.find(".vault-notes-section-title").text()).toBe("Notes");
    expect(wrapper.find('[aria-label="Nouvelle note"]').exists()).toBe(true);
  });

  it("hides the Notes title and falls back to an icon-only action in collapsed mini-rail mode", () => {
    const wrapper = mount(VaultNotesSectionHeader, {
      props: { collapsed: true },
    });

    expect(wrapper.find(".vault-notes-section-title").exists()).toBe(false);
    expect(wrapper.classes()).toContain(
      "vault-notes-section-header--collapsed",
    );
    const newNote = wrapper.get('[aria-label="Nouvelle note"]');
    expect(newNote.find(".vault-notes-new-button span").exists()).toBe(false);
    expect(newNote.text()).not.toContain("Nouvelle note");
  });
});
