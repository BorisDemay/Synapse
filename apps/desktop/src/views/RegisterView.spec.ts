import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { installSynapseUi } from "@synapse/ui";

import { useAuthStore } from "../../../web/src/stores/auth";
import RegisterView from "./RegisterView.vue";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

async function mountRegister() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: RegisterView, path: "/register" },
      { component: { template: "<div />" }, path: "/login" },
      { component: { template: "<div />" }, path: "/unlock" },
    ],
  });
  await router.push("/register");
  await router.isReady();
  const wrapper = mount(RegisterView, {
    global: { plugins: [pinia, installSynapseUi, router] },
  });
  await flushPromises();
  return { router, wrapper };
}

describe("RegisterView", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ public_signup: true }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("confirms that the account must be activated before signing in", async () => {
    const { router, wrapper } = await mountRegister();
    const auth = useAuthStore();
    vi.spyOn(auth, "register").mockResolvedValue();

    await wrapper.get("#register-email").setValue("person@example.test");
    await wrapper.get("#register-password").setValue("a secure password");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.get('[role="status"]').text()).toContain(
      "Activez votre compte, puis connectez-vous",
    );
    expect(router.currentRoute.value.path).toBe("/register");
  });

  it("prevents a second submission while registration is pending", async () => {
    const { wrapper } = await mountRegister();
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
    const { wrapper } = await mountRegister();
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
