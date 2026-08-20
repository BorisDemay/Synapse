import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import AppShell from "../AppShell.vue";

describe("AppShell", () => {
  it("expose une zone principale pour le contenu de la note", () => {
    const wrapper = mount(AppShell, {
      slots: {
        navigation: "<nav>Navigation</nav>",
        default: "<article>Note active</article>",
      },
    });

    expect(wrapper.get("main").text()).toBe("Note active");
    expect(wrapper.get("aside").text()).toBe("Navigation");
  });

  it("expose un rail de relations optionnel", () => {
    const wrapper = mount(AppShell, {
      slots: {
        default: "<article>Note active</article>",
        navigation: "<nav>Navigation</nav>",
        relations: "<p>Liens</p>",
      },
    });

    expect(wrapper.get('[aria-label="Relations de la note"]').text()).toBe(
      "Liens",
    );
  });

  it("expose un panneau d'assistant optionnel", () => {
    const wrapper = mount(AppShell, {
      slots: {
        assistant: "<p>Chat Codex</p>",
        default: "<article>Note active</article>",
        navigation: "<nav>Navigation</nav>",
      },
    });

    expect(wrapper.get('[aria-label="Assistant d\'écriture"]').text()).toBe(
      "Chat Codex",
    );
  });

  it("expose un panneau de conversations indépendant de l'assistant", () => {
    const wrapper = mount(AppShell, {
      slots: {
        assistant: "<p>Chat Codex</p>",
        assistantHistory: "<p>Fils Codex</p>",
        default: "<article>Note active</article>",
        navigation: "<nav>Navigation</nav>",
      },
    });

    expect(wrapper.get('[aria-label="Conversations Codex"]').text()).toBe(
      "Fils Codex",
    );
  });
});
