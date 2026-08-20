import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { installSynapseUi } from "@synapse/ui";

import LoginView from "./LoginView.vue";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("LoginView", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => {
      if (command === "set_instance_url") {
        return "http://127.0.0.1:3000";
      }
      if (command === "auth_public_signup") {
        return true;
      }
      if (command === "auth_login") {
        return { user_id: "user-1" };
      }
      return undefined;
    });
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
});
