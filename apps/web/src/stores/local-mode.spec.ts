import "fake-indexeddb/auto";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { clearUserOfflineData, getCachedEnvelope } from "../offline/cache";
import { listPendingOperations } from "../offline/queue";
import { useAuthStore } from "./auth";
import { useVaultStore } from "./vault";
beforeEach(async () => {
  await clearUserOfflineData("local-device");
  setActivePinia(createPinia());
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no server")));
});
afterEach(() => {
  useVaultStore().lock();
  vi.unstubAllGlobals();
});
it("creates, saves and reopens an encrypted local vault without a server", async () => {
  const auth = useAuthStore();
  await auth.enterLocalMode();
  const vault = useVaultStore();
  const id = await vault.createAndUnlockVault("local passphrase test");
  await vault.saveNote({
    id: "0198e5de-7777-7888-8999-aaaabbbbcccc",
    content: "local secret",
  });
  vault.lock();
  const { parseWrappedVaultKey, unlockVaultKey } = await import(
    "../crypto/vault-key"
  );
  const envelope = await getCachedEnvelope(auth.userId!, id);
  const key = await unlockVaultKey(
    parseWrappedVaultKey(envelope!),
    "local passphrase test",
  );
  vault.unlock(key, id);
  await vault.loadNotes(id);
  expect(vault.notes.values().next().value?.content).toBe("local secret");
  expect(await listPendingOperations(auth.userId!, id)).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
  expect(await vault.listVaultIds()).toEqual([id]);
});

it("restores the local profile in a fresh store without remote authentication", async () => {
  await useAuthStore().enterLocalMode();
  setActivePinia(createPinia());
  const restored = useAuthStore();
  expect(await restored.restoreSession()).toBe(true);
  expect(restored.isLocalMode).toBe(true);
  expect(restored.isAuthenticated).toBe(false);
  expect(restored.userId).toBe("local-device");
  expect(fetch).not.toHaveBeenCalled();
});
