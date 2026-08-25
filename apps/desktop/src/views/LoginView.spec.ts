import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { installSynapseUi } from "@synapse/ui";

import LoginView from "./LoginView.vue";

const invoke = vi.hoisted(() => vi.fn());
const nativeFetch = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("LoginView", () => {
  beforeEach(() => {
    invoke.mockReset();
    nativeFetch.mockReset();
    vi.spyOn(globalThis, "fetch").mockImplementation(nativeFetch);
    nativeFetch.mockResolvedValue(
      new Response(JSON.stringify({ public_signup: true }), { status: 200 }),
    );
    invoke.mockImplementation(async (command: string) => {
      if (command === "set_instance_url") {
        return "http://127.0.0.1:3000";
      }
      return undefined;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the register link when public signup is open", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { component: { template: "<div />" }, path: "/" },
        { component: LoginView, path: "/login" },
        { component: { template: "<div />" }, path: "/register" },
        { component: { template: "<div />" }, path: "/unlock" },
        { component: { template: "<div />" }, path: "/vault" },
      ],
    });
    await router.push("/login");
    await router.isReady();
    const wrapper = mount(LoginView, {
      global: { plugins: [pinia, installSynapseUi, router] },
    });
    await flushPromises();
    expect(wrapper.get('a[href="/register"]').text()).toContain(
      "Créer un compte",
    );
  });

  it("offers remembering the account session on the login form", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { component: { template: "<div />" }, path: "/" },
        { component: LoginView, path: "/login" },
        { component: { template: "<div />" }, path: "/register" },
        { component: { template: "<div />" }, path: "/unlock" },
        { component: { template: "<div />" }, path: "/vault" },
      ],
    });
    await router.push("/login");
    await router.isReady();
    const wrapper = mount(LoginView, {
      global: { plugins: [pinia, installSynapseUi, router] },
    });
    await flushPromises();

    expect(wrapper.get("#login-remember-device").attributes("type")).toBe(
      "checkbox",
    );
    expect(wrapper.get("#login-remember-hint").text()).toContain(
      "phrase du coffre",
    );
    expect(
      wrapper.get("#login-remember-device").attributes("aria-describedby"),
    ).toBe("login-remember-hint");
  });
});
