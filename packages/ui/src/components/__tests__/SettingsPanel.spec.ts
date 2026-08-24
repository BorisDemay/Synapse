import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import SettingsPanel from "../SettingsPanel.vue";

describe("SettingsPanel", () => {
  it("expose the trusted device revocation when the browser wrap exists", async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: true,
        deviceTrusted: true,
        open: true,
      },
    });

    expect(wrapper.get('[role="dialog"]').text()).toContain(
      "Oublier cet appareil",
    );
    expect(wrapper.text()).toContain("Cet appareil est enregistré");
    await wrapper.get('[aria-label="Oublier cet appareil"]').trigger("click");
    expect(wrapper.emitted("forgetDevice")).toHaveLength(1);
  });

  it("lets an unlocked vault remember this browser", async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: true,
        deviceTrusted: false,
        open: true,
      },
    });

    await wrapper
      .get('[aria-label="Rester déverrouillé sur ce navigateur"]')
      .trigger("click");
    expect(wrapper.emitted("rememberDevice")).toHaveLength(1);
  });

  it("includes appearance and lock controls", async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: true,
        deviceTrusted: false,
        open: true,
      },
    });

    expect(wrapper.get('[aria-label="Paramètres"]').text()).toContain(
      "Apparence",
    );
    expect(wrapper.find(".theme-toggle").exists()).toBe(true);
    await wrapper.get('[aria-label="Verrouiller le coffre"]').trigger("click");
    expect(wrapper.emitted("lockVault")).toHaveLength(1);
  });

  it("emits local vault template preferences", async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        dailyNotePattern: "Daily/YYYY-MM-DD.md",
        deviceSupported: false,
        deviceTrusted: false,
        open: true,
        templatesPath: "Templates",
      },
    });
    await wrapper.get('input[name="templates-path"]').setValue("Models");
    await wrapper
      .get('input[name="daily-note-pattern"]')
      .setValue("Journal/YYYY-MM-DD.md");
    await wrapper.get('form[data-form="vault-preferences"]').trigger("submit");
    expect(wrapper.emitted("saveVaultPreferences")?.[0]).toEqual([
      "Models",
      "Journal/YYYY-MM-DD.md",
    ]);
  });

  it("does not render the dialog when closed", () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: true,
        deviceTrusted: true,
        open: false,
      },
    });

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it("closes from the dialog dismiss control", async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: true,
        deviceTrusted: true,
        open: true,
      },
    });

    await wrapper.get('[aria-label="Fermer les paramètres"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("emits account and vault secret changes from the settings forms", async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        accountEmail: "alice@example.test",
        deviceSupported: true,
        deviceTrusted: false,
        open: true,
        sessions: [
          {
            createdAt: "2026-08-17",
            current: true,
            id: "session-current",
          },
          {
            createdAt: "2026-08-16",
            current: false,
            id: "session-other",
          },
        ],
      },
    });

    await wrapper
      .get('input[name="current-password"]')
      .setValue("old password");
    await wrapper.get('input[name="new-password"]').setValue("new password 12");
    await wrapper
      .get('input[name="confirm-password"]')
      .setValue("new password 12");
    const forms = wrapper.findAll("form.settings-form");
    await forms[2]?.trigger("submit");
    expect(wrapper.emitted("changePassword")?.[0]).toEqual([
      "old password",
      "new password 12",
    ]);

    await wrapper
      .get('input[name="current-passphrase"]')
      .setValue("old phrase");
    await wrapper.get('input[name="new-passphrase"]').setValue("new phrase");
    await wrapper
      .get('input[name="confirm-passphrase"]')
      .setValue("new phrase");
    await forms[1]?.trigger("submit");
    expect(wrapper.emitted("changePassphrase")?.[0]).toEqual([
      "old phrase",
      "new phrase",
    ]);

    await wrapper
      .get('[aria-label="Exporter les notes en Markdown"]')
      .trigger("click");
    expect(wrapper.emitted("exportNotes")).toHaveLength(1);
    await wrapper
      .get('[aria-label="Révoquer la session session-other"]')
      .trigger("click");
    expect(wrapper.emitted("revokeSession")?.[0]).toEqual(["session-other"]);
  });

  it("hides Markdown export when the host already has local files", () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: false,
        deviceTrusted: false,
        exportSupported: false,
        open: true,
      },
    });

    expect(
      wrapper.find('[aria-label="Exporter les notes en Markdown"]').exists(),
    ).toBe(false);
  });

  it("requires typing the account email before deleting", async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        accountEmail: "alice@example.test",
        deviceSupported: true,
        deviceTrusted: false,
        open: true,
      },
    });

    await wrapper.get('input[name="delete-confirmation"]').setValue("wrong");
    await wrapper
      .get('input[name="delete-password"]')
      .setValue("a secure password");
    const forms = wrapper.findAll("form.settings-form");
    await forms[forms.length - 1]?.trigger("submit");
    expect(wrapper.emitted("deleteAccount")).toBeUndefined();

    await wrapper
      .get('input[name="delete-confirmation"]')
      .setValue("alice@example.test");
    await forms[forms.length - 1]?.trigger("submit");
    expect(wrapper.emitted("deleteAccount")?.[0]).toEqual([
      "a secure password",
    ]);
  });
});
