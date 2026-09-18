import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import ConflictResolver from "../ConflictResolver.vue";

describe("ConflictResolver", () => {
  it("affiche les trois versions en texte sans exécuter le HTML", () => {
    const wrapper = mount(ConflictResolver, {
      props: {
        base: "base <img src=x onerror=alert(1)>",
        local: "local **edit**",
        remote: "remote <script>alert(1)</script>",
      },
    });

    expect(wrapper.get('[aria-label="Version de base"]').text()).toContain(
      "base <img src=x onerror=alert(1)>",
    );
    expect(wrapper.get('[aria-label="Version locale"]').text()).toContain(
      "local **edit**",
    );
    expect(wrapper.get('[aria-label="Version distante"]').text()).toContain(
      "remote <script>alert(1)</script>",
    );
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.find("img").exists()).toBe(false);
  });

  it("demande confirmation avant garder local, garder distant ou édition manuelle", async () => {
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirm);

    const wrapper = mount(ConflictResolver, {
      props: {
        base: "base",
        local: "local",
        remote: "remote",
      },
    });

    await wrapper
      .get('[aria-label="Garder la version locale"]')
      .trigger("click");
    await wrapper
      .get('[aria-label="Garder la version distante"]')
      .trigger("click");
    await wrapper.get('[aria-label="Édition manuelle"]').trigger("click");

    expect(confirm).toHaveBeenCalledTimes(3);
    expect(wrapper.emitted("keep-local")).toHaveLength(1);
    expect(wrapper.emitted("keep-remote")).toHaveLength(1);
    expect(wrapper.emitted("edit-manual")).toHaveLength(1);

    vi.unstubAllGlobals();
  });

  it("n’émet rien si la confirmation est refusée", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    const wrapper = mount(ConflictResolver, {
      props: {
        base: "base",
        local: "local",
        remote: "remote",
      },
    });

    await wrapper
      .get('[aria-label="Garder la version locale"]')
      .trigger("click");
    expect(wrapper.emitted("keep-local")).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
