import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it.each([
  "/assets/../auth/session",
  "/assets\\..\\auth",
  "//remote.invalid/script.js",
  "/index.html?token=secret",
  "/%61uth/session",
])("rejects a non-asset manifest entry %s before caching", async (path) => {
  const listeners = new Map<
    string,
    (event: { waitUntil: (promise: Promise<unknown>) => void }) => void
  >();
  const addAll = vi.fn();
  vi.stubGlobal("self", {
    location: { origin: "https://synapse.test" },
    addEventListener: (name: string, handler: never) =>
      listeners.set(name, handler),
  });
  vi.stubGlobal("caches", {
    open: vi.fn().mockResolvedValue({ addAll, put: vi.fn() }),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify([path]))),
  );
  await import("../sw");
  let pending!: Promise<unknown>;
  listeners.get("install")!({
    waitUntil: (promise) => {
      pending = promise;
    },
  });
  await expect(pending).rejects.toThrow("Invalid offline assets");
  expect(addAll).not.toHaveBeenCalled();
});
