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
    const mediaQuery = matchMedia("(prefers-color-scheme: dark)");

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

  it("explains that the account password is distinct from the local vault passphrase", async () => {
    mockSignupStatus(true);
    const wrapper = await mountRegister();

    const hint = wrapper.get("#register-password-hint").text();
    expect(hint).toContain("phrase de coffre");
    expect(hint).toContain("première connexion");
  });

  it("guides from email activation to first login and vault setup after registering", async () => {
    mockSignupStatus(true);
    const wrapper = await mountRegister();
    const auth = useAuthStore();
    const register = vi
      .spyOn(auth, "register")
      .mockImplementation(async () => undefined);

    await wrapper.get("#register-email").setValue("person@example.test");
    await wrapper.get("#register-password").setValue("a secure password");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(register).toHaveBeenCalledOnce();
    expect(wrapper.find("form").exists()).toBe(false);
    const guidance = wrapper.get('[role="status"]').text();
    expect(guidance).toContain("activation");
    expect(guidance).toContain("Activez votre compte, puis connectez-vous");
    expect(guidance).toContain("phrase de coffre");
    expect(guidance).toContain("spams");
    expect(wrapper.get('a[href="/login"]').text()).toContain(
      "Aller à la connexion",
    );
  });

  it("prevents duplicate submissions while a registration is in flight", async () => {
    mockSignupStatus(true);
    const wrapper = await mountRegister();
    const auth = useAuthStore();
    let resolveRegister: (() => void) | undefined;
    const register = vi.spyOn(auth, "register").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRegister = resolve;
        }),
    );

    await wrapper.get("#register-email").setValue("person@example.test");
    await wrapper.get("#register-password").setValue("a secure password");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(register).toHaveBeenCalledOnce();
    const submitButton = wrapper.get('button[type="submit"]');
    expect(submitButton.attributes("disabled")).toBeDefined();
    expect(submitButton.attributes("data-p-disabled")).toBe("true");

    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(register).toHaveBeenCalledOnce();

    resolveRegister?.();
    await flushPromises();

    expect(wrapper.find("form").exists()).toBe(false);
  });

  it("suggests checking the connection when registration fails without accusing the account", async () => {
    mockSignupStatus(true);
    const wrapper = await mountRegister();
    const auth = useAuthStore();
    vi.spyOn(auth, "register").mockRejectedValue(new TypeError("network down"));

    await wrapper.get("#register-email").setValue("person@example.test");
    await wrapper.get("#register-password").setValue("a secure password");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    const alert = wrapper.get('[role="alert"]').text();
    expect(alert).toContain("Inscription impossible");
    expect(alert).toContain("réessayez");
    expect(alert).not.toContain("existe déjà");
    expect(
      wrapper.get('button[type="submit"]').attributes("data-p-disabled"),
    ).toBe("false");
    expect(
      (wrapper.get("#register-password").element as HTMLInputElement).value,
    ).toBe("");
  });
});
