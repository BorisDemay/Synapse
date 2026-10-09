import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetOverlayStack } from "@synapse/ui";

import QuickAssistantPrompt from "./QuickAssistantPrompt.vue";

const models = [
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    reasoningLevels: [],
    serviceTiers: [],
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    reasoningLevels: [],
    serviceTiers: [],
  },
];

function mountPrompt(
  options: {
    activeNote?: boolean;
    busy?: boolean;
    connected?: boolean;
    model?: string;
    models?: typeof models;
    open?: boolean;
  } = {},
): VueWrapper {
  return mount(QuickAssistantPrompt, {
    attachTo: document.body,
    props: {
      activeNote: options.activeNote ?? false,
      busy: options.busy ?? false,
      connected: options.connected ?? true,
      model: options.model ?? "gpt-5.6-sol",
      models: options.models ?? models,
      open: options.open ?? true,
    },
  });
}

describe("QuickAssistantPrompt", () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    resetOverlayStack();
    document.body.removeAttribute("style");
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    resetOverlayStack();
    document.body.removeAttribute("style");
  });

  it("n’expose qu’un champ de prompt et un sélecteur de modèle", () => {
    wrapper = mountPrompt();

    const dialog = wrapper.get('[role="dialog"][aria-modal="true"]');
    expect(dialog.attributes("aria-modal")).toBe("true");
    expect(wrapper.findAll("input")).toHaveLength(1);
    expect(wrapper.get("input").attributes("type")).toBe("text");
    expect(wrapper.findAll("select")).toHaveLength(1);

    const options = wrapper.findAll("select option");
    expect(options.map((option) => option.text())).toEqual([
      "GPT-5.6 Sol",
      "GPT-5.6 Luna",
    ]);
    expect(options.map((option) => option.attributes("value"))).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-luna",
    ]);
  });

  it("émet le prompt saisi et le modèle choisi", async () => {
    wrapper = mountPrompt();

    await wrapper.get("input").setValue("Rédige un plan de journée");
    await wrapper.get("select").setValue("gpt-5.6-luna");
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("submit")).toEqual([
      [{ model: "gpt-5.6-luna", prompt: "Rédige un plan de journée" }],
    ]);
  });

  it("divulgue le transfert de note avant la soumission explicite", async () => {
    wrapper = mountPrompt({ activeNote: true });

    expect(wrapper.get('[role="note"]').text()).toContain(
      "texte en clair de la note actuellement ouverte",
    );
    await wrapper.get("input").setValue("Réécris cette note");
    expect(wrapper.emitted("submit")).toBeUndefined();
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("submit")).toHaveLength(1);

    await wrapper.setProps({ activeNote: false });
    expect(wrapper.get('[role="note"]').text()).toContain(
      "Aucune note active ne sera transmise comme contexte",
    );
  });

  it("refuse l’envoi d’un prompt vide", async () => {
    wrapper = mountPrompt();

    const submit = wrapper.get('button[type="submit"]');
    expect(submit.attributes("disabled")).toBeDefined();

    await wrapper.get("input").setValue("   ");
    expect(submit.attributes("disabled")).toBeDefined();

    await wrapper.get("input").setValue("Bonjour");
    expect(submit.attributes("disabled")).toBeUndefined();
  });

  it("désactive l’envoi quand l’assistant est déconnecté", async () => {
    wrapper = mountPrompt({ connected: false });

    expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBe(
      "",
    );
    expect(wrapper.get('[role="status"]').text()).toContain(
      "Connectez l’assistant dans les paramètres",
    );

    await wrapper.get("input").setValue("Bonjour");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("explique l’absence de modèle et désactive l’envoi", async () => {
    wrapper = mountPrompt({ models: [] });

    expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBe(
      "",
    );
    expect(wrapper.get('[role="status"]').text()).toContain(
      "Aucun modèle disponible.",
    );
    expect(wrapper.findAll("select option")).toHaveLength(0);
  });

  it("ferme sur Échap et rend le focus au déclencheur", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    wrapper = mountPrompt({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();

    const dialog = wrapper.get('[role="dialog"]');
    expect(document.activeElement).toBe(wrapper.get("input").element);
    expect(document.body.style.overflow).toBe("hidden");

    dialog.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("close")).toHaveLength(1);

    await wrapper.setProps({ open: false });
    await flushPromises();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("");
    opener.remove();
  });

  it("conserve le brouillon et ignore chaque fermeture utilisateur pendant la préparation", async () => {
    wrapper = mountPrompt({ busy: true });
    const input = wrapper.get<HTMLInputElement>(
      '[aria-label="Prompt à envoyer à l’assistant"]',
    );
    await input.setValue("Demande synthétique");

    expect(
      wrapper
        .get('[aria-label="Fermer le prompt rapide"]')
        .attributes("disabled"),
    ).toBe("");

    await wrapper
      .get('[aria-label="Fermer le prompt rapide"]')
      .trigger("click");
    await wrapper.get(".quick-assistant-backdrop").trigger("click");
    wrapper.get('[role="dialog"]').element.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );
    await flushPromises();

    expect(wrapper.emitted("close")).toBeUndefined();
    expect(wrapper.get('[role="dialog"]').isVisible()).toBe(true);
    expect(input.element.value).toBe("Demande synthétique");
  });
});
