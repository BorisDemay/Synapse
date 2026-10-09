import "fake-indexeddb/auto";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearUserOfflineData, putCachedEnvelope } from "../offline/cache";
import { useAuthStore } from "./auth";
import { useVaultStore } from "./vault";

const userId = "synthetic-discovery-user";
beforeEach(async () => {
  await clearUserOfflineData(userId);
  setActivePinia(createPinia());
  useAuthStore().$patch({ userId, isAuthenticated: true });
});
afterEach(() => {
  useVaultStore().lock();
  vi.unstubAllGlobals();
});

it("does not mistake unavailable discovery and an empty cache for a new account", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  await expect(useVaultStore().listVaultIds()).rejects.toThrow(
    "Unable to list vaults",
  );
});

it("still reopens known cached vaults when offline", async () => {
  await putCachedEnvelope(userId, "cached-vault", [1, 2, 3]);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  await expect(useVaultStore().listVaultIds()).resolves.toEqual([
    "cached-vault",
  ]);
});

it("allows creation only after a successful empty server response", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ vaults: [] }), { status: 200 }),
      ),
  );
  await expect(useVaultStore().listVaultIds()).resolves.toEqual([]);
});
