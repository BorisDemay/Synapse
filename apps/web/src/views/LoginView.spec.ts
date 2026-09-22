import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { useAuthStore, AuthError } from "../stores/auth";
import { useVaultStore } from "../stores/vault";
import LoginView from "./LoginView.vue";

function mockSignupStatus(publicSignup: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ public_signup: publicSignup }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    ),
  );
}

async function mountLogin(): Promise<{
  wrapper: VueWrapper;
  router: ReturnType<typeof createRouter>;
}> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: LoginView, path: "/login" },
      { component: { template: "<div />" }, path: "/register" },
      { component: { template: "<div />" }, path: "/unlock" },
      { component: { template: "<div />" }, path: "/vault" },
    ],
  });
  await router.push("/login");
  await router.isReady();
  const wrapper = mount(LoginView, {
    global: {
      plugins: [pinia, router, [PrimeVue, { unstyled: true }]],
    },
  });
  await flushPromises();
  return { router, wrapper };
}

describe("LoginView", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "https://synapse.local" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("explains that an unactivated account must be confirmed by email", async () => {
    mockSignupStatus(false);
    const { wrapper } = await mountLogin();
    const auth = useAuthStore();
    vi.spyOn(auth, "login").mockRejectedValue(
      new AuthError("Authentication failed", 403),
    );

    await wrapper.get("#login-email").setValue("person@example.test");
    await wrapper.get("#login-password").setValue("a secure password");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain("non activé");
    expect(wrapper.text()).not.toContain("Connexion impossible");
  });

  it("keeps the generic error for unexpected server failures", async () => {
    mockSignupStatus(false);
    const { wrapper } = await mountLogin();
    const auth = useAuthStore();
    vi.spyOn(auth, "login").mockRejectedValue(
      new AuthError("Authentication failed", 503),
    );

    await wrapper.get("#login-email").setValue("person@example.test");
    await wrapper.get("#login-password").setValue("a secure password");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain(
      "Connexion impossible",
    );
  });

  it("names wrong credentials without accusing an unknown account", async () => {
    mockSignupStatus(false);
    const { wrapper } = await mountLogin();
    const auth = useAuthStore();
    vi.spyOn(auth, "login").mockRejectedValue(
      new AuthError("Authentication failed", 401),
    );

    await wrapper.get("#login-email").setValue("person@example.test");
    await wrapper.get("#login-password").setValue("a secure password");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain(
      "Email ou mot de passe incorrect",
    );
  });

  it("distinguishes an unreachable server from a credential rejection", async () => {
    mockSignupStatus(false);
    const { wrapper } = await mountLogin();
    const auth = useAuthStore();
    vi.spyOn(auth, "login").mockRejectedValue(new TypeError("network down"));

    await wrapper.get("#login-email").setValue("person@example.test");
    await wrapper.get("#login-password").setValue("a secure password");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    const alert = wrapper.get('[role="alert"]').text();
    expect(alert).toContain("injoignable");
    expect(alert).not.toContain("Connexion impossible");
  });

  it("prevents duplicate submissions while a login request is in flight", async () => {
    mockSignupStatus(false);
    const { wrapper } = await mountLogin();
    const auth = useAuthStore();
    const vault = useVaultStore();
    let resolveLogin: (() => void) | undefined;
    const login = vi.spyOn(auth, "login").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLogin = resolve;
        }),
    );
    vi.spyOn(vault, "tryUnlockFromTrustedDevice").mockResolvedValue(false);

    await wrapper.get("#login-email").setValue("person@example.test");
    await wrapper.get("#login-password").setValue("a secure password");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(login).toHaveBeenCalledOnce();
    const submitButton = wrapper.get('button[type="submit"]');
    expect(submitButton.attributes("disabled")).toBeDefined();

    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(login).toHaveBeenCalledOnce();

    resolveLogin?.();
    await flushPromises();

    expect(
      wrapper.get('button[type="submit"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("separates the remembered account session from the trusted device and warns shared use", async () => {
    mockSignupStatus(false);
    const { wrapper } = await mountLogin();

    const hint = wrapper.get("#login-remember-hint").text();
    expect(hint).toContain("phrase du coffre");
    expect(hint).toContain("appareil de confiance");
    expect(hint).toContain("appareil partagé");
  });

  it("hides the register link when public signup is closed", async () => {
    mockSignupStatus(false);
    const { wrapper } = await mountLogin();

    expect(wrapper.find('a[href="/register"]').exists()).toBe(false);
  });

  it("shows the register link when public signup is open", async () => {
    mockSignupStatus(true);
    const { wrapper } = await mountLogin();

    expect(wrapper.get('a[href="/register"]').text()).toContain(
      "Créer un compte",
    );
  });

  it("uses an email keyboard without rejecting the development login identifier", async () => {
    mockSignupStatus(false);
    const { wrapper } = await mountLogin();

    expect(wrapper.get("#login-email").attributes("inputmode")).toBe("email");
    await wrapper.get("#login-email").setValue("test");
    expect(
      (wrapper.get("#login-email").element as HTMLInputElement).checkValidity(),
    ).toBe(true);
  });

  it("opens the vault directly when a trusted device can unlock", async () => {
    mockSignupStatus(false);
    const { router, wrapper } = await mountLogin();
    const auth = useAuthStore();
    const vault = useVaultStore();
    vi.spyOn(auth, "login").mockResolvedValue();
    vi.spyOn(vault, "tryUnlockFromTrustedDevice").mockResolvedValue(true);

    await wrapper.get("#login-email").setValue("person@example.test");
    await wrapper.get("#login-password").setValue("a secure password");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(vault.tryUnlockFromTrustedDevice).toHaveBeenCalledOnce();
    expect(router.currentRoute.value.path).toBe("/vault");
  });

  it("offers remembering the account session without skipping vault unlock", async () => {
    mockSignupStatus(false);
    const { router, wrapper } = await mountLogin();
    const auth = useAuthStore();
    const vault = useVaultStore();
    const login = vi.spyOn(auth, "login").mockResolvedValue();
    vi.spyOn(vault, "tryUnlockFromTrustedDevice").mockResolvedValue(false);

    expect(wrapper.get("#login-remember-device").attributes("type")).toBe(
      "checkbox",
    );
    expect(wrapper.get("#login-remember-hint").text()).toContain(
      "phrase du coffre",
    );
    expect(
      wrapper.get("#login-remember-device").attributes("aria-describedby"),
    ).toBe("login-remember-hint");

    await wrapper.get("#login-email").setValue("person@example.test");
    await wrapper.get("#login-password").setValue("a secure password");
    await wrapper.get("#login-remember-device").setValue(true);
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(login).toHaveBeenCalledWith(
      "person@example.test",
      "a secure password",
      {
        rememberDevice: true,
      },
    );
    expect(router.currentRoute.value.path).toBe("/unlock");
  });
});
