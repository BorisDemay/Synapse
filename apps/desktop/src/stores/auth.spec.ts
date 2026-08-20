import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "./auth";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("auth store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invoke.mockReset();
    localStorage.clear();
  });

  it("logs in through the allowlisted rust client", async () => {
    invoke
      .mockResolvedValueOnce("http://127.0.0.1:3000")
      .mockResolvedValueOnce({
        user_id: "user-1",
      });

    const auth = useAuthStore();
    await auth.login("alice@example.test", "a secure password");

    expect(invoke).toHaveBeenNthCalledWith(1, "set_instance_url", {
      url: "http://127.0.0.1:3000",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "auth_login", {
      email: "alice@example.test",
      password: "a secure password",
    });
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.userId).toBe("user-1");
  });

  it("does not expose a session cookie to vue", async () => {
    invoke
      .mockResolvedValueOnce("http://127.0.0.1:3000")
      .mockResolvedValueOnce({
        user_id: "user-1",
      });
    const auth = useAuthStore();
    await auth.login("alice@example.test", "a secure password");
    expect(JSON.stringify(auth.$state)).not.toMatch(/session=/);
  });

  it("registers through rust and never stores a cookie", async () => {
    invoke
      .mockResolvedValueOnce("http://127.0.0.1:3000")
      .mockResolvedValueOnce({
        user_id: "user-2",
      });
    const auth = useAuthStore();
    await auth.register({
      email: "bob@example.test",
      password: "a secure password",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "auth_register", {
      email: "bob@example.test",
      invitationToken: null,
      password: "a secure password",
    });
    expect(auth.isAuthenticated).toBe(true);
    expect(JSON.stringify(auth.$state)).not.toMatch(/session=/);
  });

  it("logs out through the csrf rust command", async () => {
    invoke.mockResolvedValue(undefined);
    const auth = useAuthStore();
    auth.isAuthenticated = true;
    auth.userId = "user-1";
    await auth.logout();
    expect(invoke).toHaveBeenCalledWith("auth_logout");
    expect(auth.isAuthenticated).toBe(false);
  });
});
