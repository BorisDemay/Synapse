import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import AdminView from "./AdminView.vue";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

async function mountAdmin(): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: AdminView, path: "/admin" },
      { component: { template: "<div />" }, path: "/login" },
    ],
  });
  await router.push("/admin");
  await router.isReady();
  const wrapper = mount(AdminView, {
    global: { plugins: [pinia, router, PrimeVue] },
  });
  await flushPromises();
  return wrapper;
}

describe("AdminView", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        matches: false,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists the accounts returned by the admin API", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        users: [
          {
            activated: true,
            created_at: "2026-09-18T00:00:00Z",
            email: "admin@example.test",
            is_admin: true,
          },
        ],
      }),
    );

    const wrapper = await mountAdmin();

    expect(fetch).toHaveBeenCalledWith("/auth/users", {
      credentials: "include",
    });
    expect(wrapper.text()).toContain("admin@example.test");
    expect(wrapper.text()).toContain("Administrateur");
  });

  it("creates an invitation and shows the one-time link", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ users: [] }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            email: "invitee@example.test",
            expires_at: "2026-09-19T00:00:00Z",
            token: "one-time-token",
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ users: [] }));

    const wrapper = await mountAdmin();
    await wrapper.get("#admin-invite-email").setValue("invitee@example.test");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(fetch).toHaveBeenNthCalledWith(2, "/auth/invitations", {
      body: JSON.stringify({
        email: "invitee@example.test",
        is_admin: false,
      }),
      credentials: "include",
      headers: expect.anything(),
      method: "POST",
    });
    expect(
      (wrapper.get("#admin-invite-link").element as HTMLInputElement).value,
    ).toBe(`${window.location.origin}/register?invitation=one-time-token`);
  });

  it("reports a failed account listing instead of showing an empty table", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, 503));

    const wrapper = await mountAdmin();

    expect(wrapper.get('[role="alert"]').text()).toContain(
      "Impossible de charger les utilisateurs.",
    );
  });
});
