import "fake-indexeddb/auto";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberSessionUser, resetOfflineDbHandle } from "../offline/cache";
import { useAuthStore } from "./auth";
import { useVaultStore } from "./vault";

describe("auth store", () => {
  beforeEach(() => {
    resetOfflineDbHandle();
    indexedDB.deleteDatabase("synapse-offline-v1");
    resetOfflineDbHandle();
    setActivePinia(createPinia());
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("window", {
      location: { origin: "https://synapse.local" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the server session cookie when logging in", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ user_id: "0198e5de-1111-7222-8333-444455556666" }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      );

    const auth = useAuthStore();
    await auth.login("alice@example.test", "correct horse battery staple");

    expect(fetch).toHaveBeenNthCalledWith(1, "/auth/login", {
      body: JSON.stringify({
        email: "alice@example.test",
        password: "correct horse battery staple",
      }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.userId).toBe("0198e5de-1111-7222-8333-444455556666");
  });

  it("restores an opaque session without secrets", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ user_id: "0198e5de-1111-7222-8333-444455556666" }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    const auth = useAuthStore();
    await expect(auth.restoreSession()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith("/v1/session", {
      credentials: "include",
    });
    expect(auth.isAuthenticated).toBe(true);
  });

  it("sends cookie-authenticated mutations with browser CSRF origin protection", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

    const auth = useAuthStore();
    auth.isAuthenticated = true;
    await auth.logout();

    expect(fetch).toHaveBeenCalledWith("/auth/logout", {
      credentials: "include",
      headers: { Origin: "https://synapse.local" },
      method: "POST",
    });
    expect(auth.isAuthenticated).toBe(false);
  });

  it("removes decrypted notes from memory even when server logout fails", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    const auth = useAuthStore();
    const vault = useVaultStore();
    auth.isAuthenticated = true;
    auth.userId = "0198e5de-1111-7222-8333-444455556666";
    vault.unlock(new Uint8Array(32), "0198e5de-1111-7222-8333-444455556666");
    vault.notes.set("private.md", { content: "# Private", revision: 0 });

    await expect(auth.logout()).rejects.toThrow("Logout failed");

    expect(auth.isAuthenticated).toBe(false);
    expect(vault.isUnlocked).toBe(false);
    expect(vault.notes.size).toBe(0);
  });

  it("registers through the opaque signup endpoint then logs in", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ user_id: "0198e5de-1111-7222-8333-444455556666" }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      );

    const auth = useAuthStore();
    await auth.register({
      email: "new@example.test",
      invitationToken: "invite-token",
      password: "a secure password",
    });

    expect(fetch).toHaveBeenNthCalledWith(1, "/auth/signup", {
      body: JSON.stringify({
        email: "new@example.test",
        password: "a secure password",
        invitation_token: "invite-token",
      }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(auth.isAuthenticated).toBe(true);
  });

  it("registers without an invitation token when public signup is enabled", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ user_id: "0198e5de-1111-7222-8333-444455556666" }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      );

    const auth = useAuthStore();
    await auth.register({
      email: "public@example.test",
      password: "a secure password",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/auth/signup",
      expect.objectContaining({
        body: JSON.stringify({
          email: "public@example.test",
          password: "a secure password",
        }),
      }),
    );
  });

  it("reads whether public signup is enabled", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ public_signup: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    const auth = useAuthStore();
    await expect(auth.fetchPublicSignup()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith("/auth/signup", {
      credentials: "include",
    });
  });

  it("treats an unreachable signup status as closed", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));

    const auth = useAuthStore();
    await expect(auth.fetchPublicSignup()).resolves.toBe(false);
  });

  it("restores an offline session hint when the network is unavailable", async () => {
    await rememberSessionUser("0198e5de-1111-7222-8333-444455556666");
    vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));

    const auth = useAuthStore();
    await expect(auth.restoreSession()).resolves.toBe(true);
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.isOfflineSession).toBe(true);
    expect(auth.userId).toBe("0198e5de-1111-7222-8333-444455556666");
  });

  it("changes the account password with CSRF origin and without persisting secrets", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    const auth = useAuthStore();
    auth.isAuthenticated = true;

    await auth.changePassword("a secure password", "replacement password");

    expect(fetch).toHaveBeenCalledWith("/auth/password", {
      body: JSON.stringify({
        current_password: "a secure password",
        new_password: "replacement password",
      }),
      credentials: "include",
      headers: {
        Origin: "https://synapse.local",
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(localStorage.length).toBe(0);
  });

  it("lists sessions without exposing token material", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          email: "alice@example.test",
          sessions: [
            {
              created_at: "2026-08-17 10:00:00+00",
              current: true,
              id: "0198e5de-aaaa-7bbb-8ccc-ddddeeeefff1",
            },
          ],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const auth = useAuthStore();
    const listed = await auth.listSessions();

    expect(listed.email).toBe("alice@example.test");
    expect(listed.sessions).toEqual([
      {
        createdAt: "2026-08-17 10:00:00+00",
        current: true,
        id: "0198e5de-aaaa-7bbb-8ccc-ddddeeeefff1",
      },
    ]);
    expect(auth.email).toBe("alice@example.test");
    expect(JSON.stringify(listed)).not.toContain("token_hash");
  });

  it("deletes the account then purges local ciphertext", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    const auth = useAuthStore();
    auth.isAuthenticated = true;
    auth.userId = "0198e5de-1111-7222-8333-444455556666";

    await auth.deleteAccount("a secure password");

    expect(fetch).toHaveBeenCalledWith("/auth/account/delete", {
      body: JSON.stringify({ password: "a secure password" }),
      credentials: "include",
      headers: {
        Origin: "https://synapse.local",
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.userId).toBeNull();
  });
});
