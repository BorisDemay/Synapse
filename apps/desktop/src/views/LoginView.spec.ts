import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { installSynapseUi } from "@synapse/ui";

import { AuthError, useAuthStore } from "../../../web/src/stores/auth";
import { useVaultStore } from "../../../web/src/stores/vault";

import LoginView from "./LoginView.vue";

const invoke = vi.hoisted(() => vi.fn());
const nativeFetch = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

async function mountLogin(): Promise<{
  router: ReturnType<typeof createRouter>;
  wrapper: VueWrapper;
}> {
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
  return { router, wrapper };
}

function publicSignupResponse(publicSignup: boolean) {
  return new Response(JSON.stringify({ public_signup: publicSignup }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

async function submitLogin(wrapper: VueWrapper): Promise<void> {
  await wrapper.get("#login-email").setValue("person@example.test");
  await wrapper.get("#login-password").setValue("a secure password");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
}

describe("LoginView", () => {
  beforeEach(() => {
    invoke.mockReset();
    nativeFetch.mockReset();
    vi.spyOn(globalThis, "fetch").mockImplementation(nativeFetch);
    nativeFetch.mockResolvedValue(publicSignupResponse(true));
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
    const { wrapper } = await mountLogin();

    expect(wrapper.get('a[href="/register"]').text()).toContain(
      "Créer un compte",
    );
  });

  it("offers remembering the account session on the login form", async () => {
    const { wrapper } = await mountLogin();

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

  it("separates the remembered session from the trusted device and warns shared use", async () => {
    const { wrapper } = await mountLogin();

    const hint = wrapper.get("#login-remember-hint").text();
    expect(hint).toContain("appareil de confiance");
    expect(hint).toContain("appareil partagé");
  });

  it("uses an email keyboard without rejecting the development login identifier", async () => {
    const { wrapper } = await mountLogin();

    expect(wrapper.get("#login-email").attributes("inputmode")).toBe("email");
    await wrapper.get("#login-email").setValue("test");
    expect(
      (wrapper.get("#login-email").element as HTMLInputElement).checkValidity(),
    ).toBe(true);
  });

  it("offers the local vault choice before the account form", async () => {
    const { wrapper } = await mountLogin();

    const localButton = wrapper
      .findAll("button")
      .find((candidate) => candidate.text().includes("coffre local"));
    expect(localButton).toBeDefined();
    const form = wrapper.get("form");
    expect(
      form.element.compareDocumentPosition(localButton!.element) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it("never implies that a local vault is uploaded to a future account automatically", async () => {
    const { wrapper } = await mountLogin();

    const option = wrapper.get(".local-vault-option").text();
    expect(option).toContain("jamais");
    expect(option).toContain("export");
    expect(option).not.toContain("automatiquement synchronisé");
  });

  it("explains that an unactivated account must be confirmed by email", async () => {
    const { wrapper } = await mountLogin();
    const auth = useAuthStore();
    vi.spyOn(auth, "login").mockRejectedValue(
      new AuthError("Authentication failed", 403),
    );

    await submitLogin(wrapper);

    expect(wrapper.get('[role="alert"]').text()).toContain("non activé");
  });

  it("names wrong credentials without accusing an unknown account", async () => {
    const { wrapper } = await mountLogin();
    const auth = useAuthStore();
    vi.spyOn(auth, "login").mockRejectedValue(
      new AuthError("Authentication failed", 401),
    );

    await submitLogin(wrapper);

    expect(wrapper.get('[role="alert"]').text()).toContain(
      "Email ou mot de passe incorrect",
    );
  });

  it("distinguishes an unreachable instance from a credential rejection", async () => {
    const { wrapper } = await mountLogin();
    const auth = useAuthStore();
    vi.spyOn(auth, "login").mockRejectedValue(new TypeError("network down"));

    await submitLogin(wrapper);

    const alert = wrapper.get('[role="alert"]').text();
    expect(alert).toContain("injoignable");
    expect(alert).toContain("URL de l’instance");
    expect(alert).not.toContain("Connexion impossible");
  });

  it("prevents duplicate submissions while a login request is in flight", async () => {
    const { router, wrapper } = await mountLogin();
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

    await submitLogin(wrapper);

    expect(login).toHaveBeenCalledOnce();
    const submitButton = wrapper.get('button[type="submit"]');
    expect(submitButton.attributes("disabled")).toBeDefined();

    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(login).toHaveBeenCalledOnce();

    resolveLogin?.();
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/unlock");
    expect(
      wrapper.get('button[type="submit"]').attributes("disabled"),
    ).toBeUndefined();
  });
});
