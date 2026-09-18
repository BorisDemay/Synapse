import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import AiChat from "../AiChat.vue";

describe("AiChat", () => {
  it("propose la connexion ChatGPT avant une clé API", async () => {
    const wrapper = mount(AiChat, {
      props: {
        attachments: [],
        connected: false,
        messages: [],
      },
    });

    expect(wrapper.get('[role="note"]').text()).toContain("serveur Synapse");

    await wrapper.get('input[name="codex-token"]').setValue("sk-test");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("connect")?.[0]).toEqual([
      { provider: "codex", token: "sk-test" },
    ]);
  });

  it("propose la connexion ChatGPT quand ce fournisseur est choisi", async () => {
    const wrapper = mount(AiChat, {
      props: {
        attachments: [],
        connected: false,
        messages: [],
        providers: [
          { id: "codex", label: "OpenAI — clé API" },
          {
            id: "chatgpt",
            label: "ChatGPT (connexion appareil)",
            deviceLogin: true,
          },
        ],
      },
    });

    await wrapper.get('select[name="codex-provider"]').setValue("chatgpt");
    await flushPromises();
    await wrapper.get(".ai-chat-primary-lg").trigger("click");
    expect(wrapper.emitted("connectChatgpt")).toHaveLength(1);
  });

  it("exige une URL d’API pour un fournisseur personnalisé", async () => {
    const wrapper = mount(AiChat, {
      props: {
        attachments: [],
        connected: false,
        messages: [],
        providers: [
          { id: "codex", label: "OpenAI — clé API" },
          {
            id: "custom",
            label: "Autre (URL compatible OpenAI)",
            needsBaseUrl: true,
          },
        ],
      },
    });

    await wrapper.get('select[name="codex-provider"]').setValue("custom");
    await flushPromises();
    await wrapper
      .get('input[name="codex-base-url"]')
      .setValue("https://exemple.tld/v1");
    await wrapper.get('input[name="codex-token"]').setValue("key-123");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("connect")?.[0]).toEqual([
      {
        baseUrl: "https://exemple.tld/v1",
        provider: "custom",
        token: "key-123",
      },
    ]);
  });

  it("affiche le code d'appareil ChatGPT pendant la connexion", () => {
    const wrapper = mount(AiChat, {
      props: {
        attachments: [],
        connected: false,
        deviceLogin: {
          userCode: "ABCD-EFGH",
          verificationUrl: "https://auth.openai.com/codex/device",
        },
        messages: [],
      },
    });

    expect(wrapper.get('[role="status"]').text()).toContain("ABCD-EFGH");
  });

  it("permet de fermer le panneau même hors ligne", async () => {
    const wrapper = mount(AiChat, {
      props: {
        attachments: [],
        connected: false,
        messages: [],
      },
    });

    await wrapper.get('button[name="close-codex-panel"]').trigger("click");
    expect(wrapper.emitted("closePanel")).toHaveLength(1);
  });

  it("envoie un prompt sans proposer d'actions d'écriture manuelles", async () => {
    const wrapper = mount(AiChat, {
      props: {
        attachments: [{ id: "note-1", label: "Journal" }],
        connected: true,
        messages: [
          { content: "Reformule.", id: "u1", role: "user" },
          { content: "# Journal\n\nTexte.", id: "a1", role: "assistant" },
        ],
      },
    });

    expect(wrapper.text()).toContain("Journal");
    await wrapper.get('textarea[name="codex-prompt"]').setValue("Plus court.");
    await wrapper.get(".ai-chat-composer").trigger("submit");
    expect(wrapper.emitted("send")?.[0]).toEqual(["Plus court."]);

    expect(wrapper.find(".ai-chat-actions").exists()).toBe(false);
  });

  it("expose des contrôles discrets pour les panneaux et la fermeture de Codex", async () => {
    const wrapper = mount(AiChat, {
      props: {
        attachments: [],
        connected: true,
        conversationsPanelOpen: true,
        historyPanelOpen: false,
        messages: [],
      },
    });

    const conversations = wrapper.get(
      'button[name="toggle-codex-conversations"]',
    );
    expect(conversations.attributes("aria-pressed")).toBe("true");
    await conversations.trigger("click");
    expect(wrapper.emitted("toggleConversations")).toHaveLength(1);

    await wrapper.get('button[name="toggle-note-history"]').trigger("click");
    expect(wrapper.emitted("toggleHistory")).toHaveLength(1);

    await wrapper.get('button[name="close-codex-panel"]').trigger("click");
    expect(wrapper.emitted("closePanel")).toHaveLength(1);
  });

  it("permet de changer de modèle une fois connecté", async () => {
    const wrapper = mount(AiChat, {
      props: {
        attachments: [],
        connected: true,
        messages: [],
        model: "gpt-5.6-sol",
        models: [
          { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
          { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
        ],
      },
    });

    await wrapper
      .get('select[name="codex-model-select"]')
      .setValue("gpt-5.6-luna");
    expect(wrapper.emitted("update:model")?.[0]).toEqual(["gpt-5.6-luna"]);
  });

  it("affiche un slider de profondeur et un switch fast issus du catalogue", async () => {
    const wrapper = mount(AiChat, {
      props: {
        attachments: [],
        connected: true,
        fast: false,
        fastAvailable: true,
        fastLabel: "Fast",
        messages: [],
        model: "gpt-5.6-sol",
        models: [{ id: "gpt-5.6-sol", label: "GPT-5.6 Sol" }],
        reasoningEffort: "medium",
        reasoningLevels: [
          { id: "low", label: "Faster" },
          { id: "medium", label: "Balanced" },
          { id: "high", label: "Deeper" },
        ],
      },
    });

    const slider = wrapper.get('input[name="codex-reasoning"]');
    expect(slider.attributes("max")).toBe("2");
    expect(wrapper.text()).toContain("Balanced");
    await slider.setValue("2");
    expect(wrapper.emitted("update:reasoningEffort")?.[0]).toEqual(["high"]);

    const toggle = wrapper.get('input[name="codex-fast"]');
    expect(wrapper.text()).toContain("Fast");
    await toggle.setValue(true);
    expect(wrapper.emitted("update:fast")?.[0]).toEqual([true]);
  });

  it("n'invente pas de profondeur ni de fast sans métadonnées catalogue", () => {
    const wrapper = mount(AiChat, {
      props: {
        attachments: [],
        connected: true,
        messages: [],
        model: "gpt-5.6-luna",
        models: [{ id: "gpt-5.6-luna", label: "GPT-5.6 Luna" }],
      },
    });

    expect(wrapper.find('input[name="codex-reasoning"]').exists()).toBe(false);
    expect(wrapper.find('input[name="codex-fast"]').exists()).toBe(false);
  });
});
