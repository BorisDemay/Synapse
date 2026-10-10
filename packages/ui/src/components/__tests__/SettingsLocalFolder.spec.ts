import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { displayLocalPath } from "../../vault/local-path";
import SettingsPanel from "../SettingsPanel.vue";

const baseProps = { deviceSupported: false, deviceTrusted: false, open: true };

async function openVaultCategory(props: Record<string, unknown>) {
  const wrapper = mount(SettingsPanel, { props: { ...baseProps, ...props } });
  await wrapper.get('[data-settings-category="Coffre"]').trigger("click");
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe("displayLocalPath", () => {
  it("retire le préfixe Windows des chemins longs", () => {
    expect(displayLocalPath("\\\\?\\C:\\Users\\Ada\\Documents\\Synapse")).toBe(
      "C:\\Users\\Ada\\Documents\\Synapse",
    );
    expect(displayLocalPath("\\\\?\\UNC\\nas\\partage\\Synapse")).toBe(
      "\\\\nas\\partage\\Synapse",
    );
  });

  it("laisse les autres chemins intacts", () => {
    expect(displayLocalPath("/home/ada/Synapse")).toBe("/home/ada/Synapse");
    expect(displayLocalPath("C:\\Synapse")).toBe("C:\\Synapse");
  });
});

describe("SettingsPanel — copie Markdown locale", () => {
  it("présente le dossier, l'avertissement et l'action dans la catégorie Coffre", async () => {
    const wrapper = await openVaultCategory({
      localFolderPath: "\\\\?\\C:\\Users\\Ada\\Documents\\Synapse\\coffre",
      localFolderSupported: true,
    });

    const section = wrapper.get('[data-test="local-folder"]');
    expect(section.get('[data-test="local-folder-path"]').text()).toBe(
      "C:\\Users\\Ada\\Documents\\Synapse\\coffre",
    );
    expect(section.text()).toContain("lisibles après verrouillage");

    await section.get("button").trigger("click");
    expect(wrapper.emitted("chooseLocalFolder")).toHaveLength(1);
  });

  it("signale l'échec du choix d'un dossier", async () => {
    const wrapper = await openVaultCategory({
      localFolderError: "Impossible de choisir ce dossier.",
      localFolderSupported: true,
    });

    expect(
      wrapper.get('[data-test="local-folder"] [role="alert"]').text(),
    ).toContain("Impossible de choisir ce dossier.");
  });

  it("n'apparaît pas quand la plateforme n'écrit pas de dossier local", async () => {
    const wrapper = await openVaultCategory({});

    expect(wrapper.find('[data-test="local-folder"]').exists()).toBe(false);
  });
});
