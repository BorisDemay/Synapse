import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { installSynapseUi } from "@synapse/ui";

import { useAuthStore } from "../../../web/src/stores/auth";

import RegisterView from "./RegisterView.vue";

const invoke = vi.hoisted(() => vi.fn());
const nativeFetch = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

async function mountRegister(
  path = "/register",
): Promise<{ router: ReturnType<typeof createRouter>; wrapper: VueWrapper }> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: { template: "<div />" }, path: "/" },
      { component: RegisterView, path: "/register" },
      { component: { template: "<div />" }, path: "/login" },
      { component: { template: "<div />" }, path: "/unlock" },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(RegisterView, {
    global: { plugins: [pinia, installSynapseUi, router] },
  });
  await flushPromises();
  return { router, wrapper };
}

async function submitRegister(wrapper: VueWrapper): Promise<void> {
  await wrapper.get("#register-instance").setValue("http://127.0.0.1:3000");
  await wrapper.get("#register-email").setValue("person@example.test");
  await wrapper.get("#register-password").setValue("a secure password");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
}

describe("RegisterView", () => {
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

  it("guides from email activation to login instead of opening an inactive vault", async () => {
    const { router, wrapper } = await mountRegister();
    const auth = useAuthStore();
    const register = vi
      .spyOn(auth, "register")
      .mockImplementation(async () => undefined);

    await submitRegister(wrapper);

    expect(register).toHaveBeenCalledOnce();
    expect(router.currentRoute.value.path).toBe("/register");
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

  it("explains that the account password is distinct from the local vault passphrase", async () => {
    const { wrapper } = await mountRegister();

    const hint = wrapper.get("#register-password-hint").text();
    expect(hint).toContain("phrase de coffre");
    expect(hint).toContain("première connexion");
  });

  it("prevents duplicate submissions while a registration is in flight", async () => {
    const { wrapper } = await mountRegister();
    const auth = useAuthStore();
    let resolveRegister: (() => void) | undefined;
    const register = vi.spyOn(auth, "register").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRegister = resolve;
        }),
    );

    await submitRegister(wrapper);

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
    const { wrapper } = await mountRegister();
    const auth = useAuthStore();
    vi.spyOn(auth, "register").mockRejectedValue(new TypeError("network down"));

    await submitRegister(wrapper);

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
