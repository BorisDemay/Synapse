import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { useAuthStore } from "../stores/auth";
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
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "https://synapse.local" },
    });
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("provides MediaQueryList listeners required by the mounted theme toggle", () => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    expect(mediaQuery.addEventListener).toBeTypeOf("function");
    expect(mediaQuery.removeEventListener).toBeTypeOf("function");
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

  it("confirms that the account must be activated before signing in", async () => {
    mockSignupStatus(true);
    const wrapper = await mountRegister();
    const auth = useAuthStore();
    vi.spyOn(auth, "register").mockResolvedValue();

    await wrapper.get("#register-email").setValue("person@example.test");
    await wrapper.get("#register-password").setValue("a secure password");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.get('[role="status"]').text()).toContain(
      "Activez votre compte, puis connectez-vous",
    );
  });

  it("prevents a second submission while registration is pending", async () => {
    mockSignupStatus(true);
    const wrapper = await mountRegister();
    const auth = useAuthStore();
    let resolveRegistration: (() => void) | undefined;
    const register = vi.spyOn(auth, "register").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRegistration = resolve;
        }),
    );

    await wrapper.get("#register-email").setValue("person@example.test");
    await wrapper.get("#register-password").setValue("a secure password");
    const form = wrapper.get("form");
    await form.trigger("submit");
    await form.trigger("submit");

    expect(
      wrapper.get('button[type="submit"]').attributes("data-p-disabled"),
    ).toBe("true");
    expect(register).toHaveBeenCalledOnce();

    resolveRegistration?.();
  });

  it("reenables registration after a failure and clears the password", async () => {
    mockSignupStatus(true);
    const wrapper = await mountRegister();
    const auth = useAuthStore();
    vi.spyOn(auth, "register").mockRejectedValue(new Error("server detail"));

    await wrapper.get("#register-email").setValue("person@example.test");
    await wrapper.get("#register-password").setValue("a secure password");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(
      wrapper.get('button[type="submit"]').attributes("data-p-disabled"),
    ).toBe("false");
    expect(
      (wrapper.get("#register-password").element as HTMLInputElement).value,
    ).toBe("");
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "Inscription impossible.",
    );
  });
});
