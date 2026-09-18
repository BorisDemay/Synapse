import { describe, expect, it } from "vitest";

import { createAppRouter } from "./router";

describe("application routes", () => {
  it("redirects an unauthenticated visitor to login", async () => {
    const auth = { isAuthenticated: false };
    const vault = { hasEncryptedVault: true, isUnlocked: false };
    const router = createAppRouter(auth, vault, { memory: true });

    await router.push("/vault");
    await router.isReady();

    expect(router.currentRoute.value.fullPath).toBe("/login");
  });

  it("redirects an authenticated visitor with a locked vault to unlock", async () => {
    const auth = { isAuthenticated: true };
    const vault = { hasEncryptedVault: false, isUnlocked: false };
    const router = createAppRouter(auth, vault, { memory: true });

    await router.push("/vault");
    await router.isReady();

    expect(router.currentRoute.value.fullPath).toBe("/unlock");
  });

  it("allows an unauthenticated visitor to open the register page", async () => {
    const auth = { isAuthenticated: false };
    const vault = { hasEncryptedVault: false, isUnlocked: false };
    const router = createAppRouter(auth, vault, { memory: true });

    await router.push("/register");
    await router.isReady();

    expect(router.currentRoute.value.fullPath).toBe("/register");
  });

  it("skips the login form when the account session is already valid", async () => {
    const auth = { isAuthenticated: true };
    const vault = { hasEncryptedVault: true, isUnlocked: false };
    const router = createAppRouter(auth, vault, { memory: true });

    await router.push("/login");
    await router.isReady();

    expect(router.currentRoute.value.fullPath).toBe("/unlock");
  });

  it("lands an administrator without an unlocked vault on the admin console", async () => {
    const auth = { isAdmin: true, isAuthenticated: true };
    const vault = { hasEncryptedVault: false, isUnlocked: false };
    const router = createAppRouter(auth, vault, { memory: true });

    await router.push("/login");
    await router.isReady();
    expect(router.currentRoute.value.fullPath).toBe("/admin");

    await router.push("/admin");
    expect(router.currentRoute.value.fullPath).toBe("/admin");
  });

  it("keeps the admin console out of reach for a regular account", async () => {
    const auth = { isAdmin: false, isAuthenticated: true };
    const vault = { hasEncryptedVault: false, isUnlocked: false };
    const router = createAppRouter(auth, vault, { memory: true });

    await router.push("/admin");
    await router.isReady();

    expect(router.currentRoute.value.fullPath).toBe("/unlock");
  });

  it("sends an authenticated administrator to the vault once it is unlocked", async () => {
    const auth = { isAdmin: true, isAuthenticated: true };
    const vault = { hasEncryptedVault: true, isUnlocked: true };
    const router = createAppRouter(auth, vault, { memory: true });

    await router.push("/login");
    await router.isReady();

    expect(router.currentRoute.value.fullPath).toBe("/vault");
  });
});
