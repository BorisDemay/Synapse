import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";

import {
  PANEL_WIDTH_BOUNDS,
  PANEL_WIDTH_STORAGE_KEY,
  resetPanelLayoutState,
  usePanelLayout,
} from "../../panel-resize";
import {
  resetSidebarLayoutState,
  useSidebarLayout,
} from "../../sidebar-layout";
import { resetThemeState, useTheme } from "../../theme";
import SettingsPanel from "../SettingsPanel.vue";

function selectCategory(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.get(`[data-settings-category="${label}"]`).trigger("click");
}

describe("SettingsPanel", () => {
  it("renders category pane headings with section title styling", async () => {
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
        ],
      },
    });

    const sectionHeadingIds = [
      "settings-appearance",
      "settings-vault",
      "settings-device",
      "settings-sessions",
      "settings-account",
      "settings-delete",
    ] as const;

    for (const id of sectionHeadingIds) {
      if (id === "settings-vault") {
        await selectCategory(wrapper, "Coffre");
      } else if (id === "settings-device" || id === "settings-sessions") {
        await selectCategory(wrapper, "Appareil");
      } else if (id === "settings-account" || id === "settings-delete") {
        await selectCategory(wrapper, "Compte");
      }

      const heading = wrapper.get(`#${id}`);
      expect(heading.element.tagName).toBe("H3");
      expect(heading.classes()).toContain("settings-section-title");
    }
  });

  it("uses a wider layout with a category sidebar", () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: true,
        deviceTrusted: false,
        open: true,
      },
    });

    const panel = wrapper.get(".settings-panel");
    expect(panel.classes()).toContain("settings-panel-wide");
    expect(
      wrapper.get('[aria-label="Catégories de paramètres"]').exists(),
    ).toBe(true);
  });

  it("uses a viewport-based fixed height with a scrollable content pane", () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: true,
        deviceTrusted: false,
        open: true,
      },
    });

    const panel = wrapper.get(".settings-panel");
    expect(panel.classes()).toContain("settings-panel-fixed");

    expect(wrapper.get('[data-test="settings-content"]').classes()).toContain(
      "settings-content-scroll",
    );
    expect(wrapper.get(".settings-body").classes()).toContain(
      "settings-body-fill",
    );
    expect(wrapper.get(".settings-nav").classes()).toContain(
      "settings-nav-scroll",
    );
  });

  it("keeps action controls from stretching to fill the content pane", async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: true,
        deviceTrusted: true,
        open: true,
      },
    });

    expect(wrapper.get(".settings-content").classes()).toContain(
      "settings-content-compact",
    );

    await selectCategory(wrapper, "Appareil");
    expect(wrapper.get('[aria-label="Oublier cet appareil"]').exists()).toBe(
      true,
    );
  });

  it("shows only the active category content", async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        accountEmail: "alice@example.test",
        deviceSupported: true,
        deviceTrusted: false,
        open: true,
      },
    });

    expect(wrapper.find("#settings-appearance").exists()).toBe(true);
    expect(wrapper.find("#settings-vault").exists()).toBe(false);
    expect(wrapper.find("#settings-account").exists()).toBe(false);

    await selectCategory(wrapper, "Coffre");
    expect(wrapper.find("#settings-vault").exists()).toBe(true);
    expect(wrapper.find("#settings-appearance").exists()).toBe(false);

    await selectCategory(wrapper, "Compte");
    expect(wrapper.find("#settings-account").exists()).toBe(true);
    expect(wrapper.find("#settings-vault").exists()).toBe(false);
    expect(wrapper.find("#settings-sessions").exists()).toBe(false);
  });

  it("renders active sessions under Appareil, not Compte", async () => {
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

    await selectCategory(wrapper, "Appareil");
    expect(wrapper.find("#settings-sessions").exists()).toBe(true);
    expect(wrapper.find(".settings-sessions").exists()).toBe(true);

    await selectCategory(wrapper, "Compte");
    expect(wrapper.find("#settings-sessions").exists()).toBe(false);
    expect(wrapper.find(".settings-sessions").exists()).toBe(false);
  });

  it("marks the active category with aria-current", async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: true,
        deviceTrusted: false,
        open: true,
      },
    });

    const appearance = wrapper.get('[data-settings-category="Apparence"]');
    expect(appearance.attributes("aria-current")).toBe("page");

    await selectCategory(wrapper, "Coffre");
    expect(appearance.attributes("aria-current")).toBeUndefined();
    expect(
      wrapper
        .get('[data-settings-category="Coffre"]')
        .attributes("aria-current"),
    ).toBe("page");
  });

  it("hides the device category when the host does not support it and there are no sessions", () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: false,
        deviceTrusted: false,
        open: true,
        sessions: [],
      },
    });

    expect(wrapper.find('[data-settings-category="Appareil"]').exists()).toBe(
      false,
    );
  });

  it("shows the device category when sessions exist even without device support", () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: false,
        deviceTrusted: false,
        open: true,
        sessions: [
          {
            createdAt: "2026-08-17",
            current: true,
            id: "session-current",
          },
        ],
      },
    });

    expect(wrapper.find('[data-settings-category="Appareil"]').exists()).toBe(
      true,
    );
  });

  it("hides the account category when offline", () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: true,
        deviceTrusted: false,
        offline: true,
        open: true,
      },
    });

    expect(wrapper.find('[data-settings-category="Compte"]').exists()).toBe(
      false,
    );
  });

  it("expose the trusted device revocation when the browser wrap exists", async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: true,
        deviceTrusted: true,
        open: true,
      },
    });

    await selectCategory(wrapper, "Appareil");
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

    await selectCategory(wrapper, "Appareil");
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
    expect(wrapper.find('[data-test="appearance-theme"]').exists()).toBe(true);

    await selectCategory(wrapper, "Coffre");
    await wrapper.get('[aria-label="Verrouiller le coffre"]').trigger("click");
    expect(wrapper.emitted("lockVault")).toHaveLength(1);
  });

  describe("appearance preferences", () => {
    beforeEach(() => {
      window.localStorage.clear();
      document.documentElement.classList.remove("synapse-dark");
      document.documentElement.style.colorScheme = "";
      resetThemeState();
      resetSidebarLayoutState();
      resetPanelLayoutState();
    });

    function mountAppearance() {
      return mount(SettingsPanel, {
        props: {
          deviceSupported: false,
          deviceTrusted: false,
          open: true,
        },
      });
    }

    it("groups device-local theme and sidebar controls with French labels", () => {
      const wrapper = mountAppearance();
      const content = wrapper.get('[data-test="settings-content"]');

      expect(content.text()).toContain("Thème");
      expect(content.text()).toContain("Clair");
      expect(content.text()).toContain("Sombre");
      expect(content.text()).toContain("Système");
      expect(content.text()).toContain("Barre latérale");
      expect(content.text()).toContain("Mini-rail");
      expect(content.text()).toContain("Mode compact");
      expect(content.text()).toContain("hors du coffre");
      expect(content.get("#settings-appearance-theme").element.tagName).toBe(
        "H4",
      );
      expect(content.get("#settings-appearance-sidebar").element.tagName).toBe(
        "H4",
      );
      expect(wrapper.find('[data-test="appearance-theme"]').exists()).toBe(
        true,
      );
      expect(
        wrapper.find('[data-test="appearance-sidebar-collapsed"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="appearance-sidebar-compact"]').exists(),
      ).toBe(true);
      expect(wrapper.find('[data-test="appearance-reset"]').exists()).toBe(
        true,
      );
    });

    it("persists the chosen theme including the system option", async () => {
      const wrapper = mountAppearance();
      const theme = useTheme();

      await wrapper
        .get('[data-test="appearance-theme"] input[value="dark"]')
        .setValue();

      expect(theme.preference.value).toBe("dark");
      expect(theme.mode.value).toBe("dark");
      expect(window.localStorage.getItem("synapse-ui-theme")).toBe("dark");

      await wrapper
        .get('[data-test="appearance-theme"] input[value="system"]')
        .setValue();

      expect(theme.preference.value).toBe("system");
      expect(window.localStorage.getItem("synapse-ui-theme")).toBe("system");
    });

    it("toggles the persisted sidebar mini-rail and compact explorer", async () => {
      const wrapper = mountAppearance();
      const sidebar = useSidebarLayout();

      await wrapper
        .get('[data-test="appearance-sidebar-collapsed"] input')
        .setValue();
      await wrapper
        .get('[data-test="appearance-sidebar-compact"] input')
        .setValue();

      expect(sidebar.collapsed.value).toBe(true);
      expect(sidebar.compact.value).toBe(true);
      expect(window.localStorage.getItem("synapse-ui-sidebar-collapsed")).toBe(
        "true",
      );
      expect(window.localStorage.getItem("synapse-ui-sidebar-compact")).toBe(
        "true",
      );

      await wrapper
        .get('[data-test="appearance-sidebar-collapsed"] input')
        .setValue(false);

      expect(sidebar.collapsed.value).toBe(false);
      expect(window.localStorage.getItem("synapse-ui-sidebar-collapsed")).toBe(
        "false",
      );
    });

    it("resets theme, sidebar layout, and panel widths on this device", async () => {
      const theme = useTheme();
      theme.setPreference("dark");
      const sidebar = useSidebarLayout();
      sidebar.setCollapsed(true);
      sidebar.setCompact(true);
      const panels = usePanelLayout();
      panels.setPanelWidth("sidebar", 400, true);

      const wrapper = mountAppearance();
      await wrapper.get('[data-test="appearance-reset"]').trigger("click");

      expect(theme.preference.value).toBe("system");
      expect(sidebar.collapsed.value).toBe(false);
      expect(sidebar.compact.value).toBe(false);
      expect(panels.widths.sidebar).toBe(PANEL_WIDTH_BOUNDS.sidebar.default);
      expect(window.localStorage.getItem("synapse-ui-theme")).toBe("system");
      expect(window.localStorage.getItem("synapse-ui-sidebar-collapsed")).toBe(
        "false",
      );
      expect(window.localStorage.getItem("synapse-ui-sidebar-compact")).toBe(
        "false",
      );
      const storedWidths = JSON.parse(
        window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY) ?? "{}",
      );
      expect(storedWidths.sidebar).toBe(PANEL_WIDTH_BOUNDS.sidebar.default);
    });
  });

  it("emits the local templates preference", async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: false,
        deviceTrusted: false,
        open: true,
        templatesPath: "Templates",
      },
    });
    await selectCategory(wrapper, "Coffre");
    await wrapper.get('input[name="templates-path"]').setValue("Models");
    await wrapper.get('form[data-form="vault-preferences"]').trigger("submit");
    expect(wrapper.emitted("saveVaultPreferences")?.[0]).toEqual(["Models"]);
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

    await selectCategory(wrapper, "Compte");
    await wrapper
      .get('input[name="current-password"]')
      .setValue("old password");
    await wrapper.get('input[name="new-password"]').setValue("new password 12");
    await wrapper
      .get('input[name="confirm-password"]')
      .setValue("new password 12");
    await wrapper.get('form[data-form="account-password"]').trigger("submit");
    expect(wrapper.emitted("changePassword")?.[0]).toEqual([
      "old password",
      "new password 12",
    ]);

    await selectCategory(wrapper, "Coffre");
    await wrapper
      .get('input[name="current-passphrase"]')
      .setValue("old phrase");
    await wrapper.get('input[name="new-passphrase"]').setValue("new phrase");
    await wrapper
      .get('input[name="confirm-passphrase"]')
      .setValue("new phrase");
    await wrapper.get('form[data-form="vault-passphrase"]').trigger("submit");
    expect(wrapper.emitted("changePassphrase")?.[0]).toEqual([
      "old phrase",
      "new phrase",
    ]);

    await wrapper
      .get('[aria-label="Exporter les notes en Markdown"]')
      .trigger("click");
    expect(wrapper.emitted("exportNotes")).toHaveLength(1);

    await selectCategory(wrapper, "Appareil");
    await wrapper
      .get('[aria-label="Révoquer la session session-other"]')
      .trigger("click");
    expect(wrapper.emitted("revokeSession")?.[0]).toEqual(["session-other"]);
  });

  it("hides Markdown export when the host already has local files", async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        deviceSupported: false,
        deviceTrusted: false,
        exportSupported: false,
        open: true,
      },
    });

    await selectCategory(wrapper, "Coffre");
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

    await selectCategory(wrapper, "Compte");
    await wrapper.get('input[name="delete-confirmation"]').setValue("wrong");
    await wrapper
      .get('input[name="delete-password"]')
      .setValue("a secure password");
    await wrapper.get('form[data-form="account-delete"]').trigger("submit");
    expect(wrapper.emitted("deleteAccount")).toBeUndefined();

    await wrapper
      .get('input[name="delete-confirmation"]')
      .setValue("alice@example.test");
    await wrapper.get('form[data-form="account-delete"]').trigger("submit");
    expect(wrapper.emitted("deleteAccount")?.[0]).toEqual([
      "a secure password",
    ]);
  });
});
