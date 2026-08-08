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
});
