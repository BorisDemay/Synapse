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
});
