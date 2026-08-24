import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "./auth";

const invoke = vi.hoisted(() => vi.fn());
const nativeFetch = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("auth store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invoke.mockReset();
    nativeFetch.mockReset();
    vi.spyOn(globalThis, "fetch").mockImplementation(nativeFetch);
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs in through the allowlisted fetch bridge", async () => {
    invoke.mockResolvedValue("http://127.0.0.1:3000");
    nativeFetch
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user_id: "user-1" }), { status: 200 }),
      );

    const auth = useAuthStore();
    await auth.login("alice@example.test", "a secure password");

    expect(invoke).toHaveBeenNthCalledWith(1, "set_instance_url", {
      url: "http://127.0.0.1:3000",
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(nativeFetch).toHaveBeenNthCalledWith(
      1,
      "/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.userId).toBe("user-1");
  });

  it("does not expose a session cookie to vue", async () => {
    invoke.mockResolvedValue("http://127.0.0.1:3000");
    nativeFetch
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user_id: "user-1" }), { status: 200 }),
      );
    const auth = useAuthStore();
    await auth.login("alice@example.test", "a secure password");
    expect(JSON.stringify(auth.$state)).not.toMatch(/session=/);
  });

  it("registers through rust and never stores a cookie", async () => {
    invoke.mockResolvedValue("http://127.0.0.1:3000");
    nativeFetch
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user_id: "user-2" }), { status: 200 }),
      );
    const auth = useAuthStore();
    await auth.register({
      email: "bob@example.test",
      password: "a secure password",
    });
    expect(nativeFetch).toHaveBeenNthCalledWith(
      1,
      "/auth/signup",
      expect.objectContaining({ method: "POST" }),
    );
    expect(auth.isAuthenticated).toBe(true);
    expect(JSON.stringify(auth.$state)).not.toMatch(/session=/);
  });

  it("logs out through the allowlisted fetch bridge", async () => {
    invoke.mockResolvedValue(undefined);
    nativeFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const auth = useAuthStore();
    auth.isAuthenticated = true;
    auth.userId = "user-1";
    await auth.logout();
    expect(nativeFetch).toHaveBeenCalledWith(
      "/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
    expect(auth.isAuthenticated).toBe(false);
  });
});
