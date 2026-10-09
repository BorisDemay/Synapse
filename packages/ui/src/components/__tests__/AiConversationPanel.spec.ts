import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import AiConversationPanel from "../AiConversationPanel.vue";

describe("AiConversationPanel", () => {
  it("expose un panneau latéral d'onglets pour les conversations", async () => {
    const wrapper = mount(AiConversationPanel, {
      props: {
        activeConversationId: "conversation-1",
        conversations: [
          { id: "conversation-1", title: "Plan voyage", updatedAt: 20 },
          { id: "conversation-2", title: "Journal", updatedAt: 10 },
        ],
      },
    });

    expect(wrapper.get('[role="tablist"]').text()).toContain("Plan voyage");
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe(
      "Plan voyage",
    );

    await wrapper
      .get('button[name="close-codex-conversations"]')
      .trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);

    await wrapper.get('button[name="new-codex-conversation"]').trigger("click");
    expect(wrapper.emitted("newConversation")).toHaveLength(1);

    await wrapper
      .get('[role="tab"][name="codex-conversation-conversation-2"]')
      .trigger("click");
    expect(wrapper.emitted("openConversation")?.[0]).toEqual([
      "conversation-2",
    ]);
  });
});
