import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import RegisterView from "./RegisterView.vue";

function mockSignupStatus(publicSignup: boolean | "error") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      if (publicSignup === "error") {
        return Promise.reject(new TypeError("offline"));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ public_signup: publicSignup }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    }),
  );
}

async function mountRegister(path = "/register"): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: RegisterView, path: "/register" },
      { component: { template: "<div />" }, path: "/login" },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(RegisterView, {
    global: {
      plugins: [pinia, router, [PrimeVue, { unstyled: true }]],
    },
  });
  await flushPromises();
  return wrapper;
}

describe("RegisterView", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { origin: "https://synapse.local" },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
      matchMedia: () => ({ matches: false }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides the form when public signup is closed", async () => {
    mockSignupStatus(false);
    const wrapper = await mountRegister();

    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain(
      "L’inscription n’est pas disponible",
    );
  });

  it("hides the form when the signup status cannot be read", async () => {
    mockSignupStatus("error");
    const wrapper = await mountRegister();

    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain(
      "L’inscription n’est pas disponible",
    );
  });

  it("shows the form when public signup is open", async () => {
    mockSignupStatus(true);
    const wrapper = await mountRegister();

    expect(wrapper.find("form").exists()).toBe(true);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  it("shows the form for an invitation even when public signup is closed", async () => {
    mockSignupStatus(false);
    const wrapper = await mountRegister("/register?invitation=invite-token");

    expect(wrapper.find("form").exists()).toBe(true);
    expect(
      (wrapper.get("#register-invitation").element as HTMLInputElement).value,
    ).toBe("invite-token");
  });
});
