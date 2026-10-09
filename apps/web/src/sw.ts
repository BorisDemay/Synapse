/// <reference lib="webworker" />

const CACHE = "synapse-assets-__SYNAPSE_PRECACHE_HASH__";

const worker = self as unknown as ServiceWorkerGlobalScope;

function isPrivateApi(pathname: string): boolean {
  return (
    pathname === "/build.json" ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/v1") ||
    pathname.startsWith("/vaults") ||
    pathname.startsWith("/health") ||
    pathname.startsWith("/updates")
  );
}

worker.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch("/precache-manifest.json", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Offline assets unavailable");
      const assets: unknown = await response.clone().json();
      if (
        !Array.isArray(assets) ||
        assets.some(
          (path) =>
            typeof path !== "string" ||
            !path.startsWith("/") ||
            path.startsWith("//") ||
            path.includes("\\") ||
            path.includes("?") ||
            path.includes("#") ||
            path.includes("%") ||
            new URL(path, worker.location.origin).pathname !== path ||
            isPrivateApi(path),
        )
      )
        throw new Error("Invalid offline assets");
      const cache = await caches.open(CACHE);
      await cache.addAll(assets as string[]);
      await cache.put("/precache-manifest.json", response);
    })(),
  );
});

worker.addEventListener("message", (event) => {
  if (event.data?.type === "SYNAPSE_ACTIVATE_UPDATE")
    event.waitUntil(worker.skipWaiting());
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const prior = (await caches.keys()).filter(
        (key) => key.startsWith("synapse-assets-") && key !== CACHE,
      );
      const clients = await worker.clients.matchAll({
        includeUncontrolled: true,
      });
      if (clients.length === 0)
        await Promise.all(prior.map((key) => caches.delete(key)));
      // Existing pages keep their old controller/assets until their explicit reload.
      if (prior.length === 0) await worker.clients.claim();
    })(),
  );
});

worker.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== worker.location.origin || isPrivateApi(url.pathname)) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (request.mode === "navigate") {
        try {
          const fresh = await fetch(request);
          return fresh;
        } catch {
          const fallback = await cache.match("/index.html");
          if (fallback) return fallback;
          throw new Error("offline shell unavailable");
        }
      }

      const manifest = await cache.match("/precache-manifest.json");
      const assets = manifest ? ((await manifest.json()) as string[]) : [];
      if (!assets.includes(url.pathname)) {
        for (const name of (await caches.keys()).filter(
          (name) => name.startsWith("synapse-assets-") && name !== CACHE,
        )) {
          const previous = await caches.open(name);
          const manifest = await previous.match("/precache-manifest.json");
          if (
            manifest &&
            ((await manifest.json()) as string[]).includes(url.pathname)
          ) {
            const cached = await previous.match(url.pathname);
            if (cached) return cached;
          }
        }
        return fetch(request);
      }
      const cached = await cache.match(url.pathname);
      if (cached) return cached;
      try {
        const fresh = await fetch(request);
        if (fresh.ok) {
          await cache.put(request, fresh.clone());
        }
        return fresh;
      } catch (error) {
        if (cached) {
          return cached;
        }
        throw error;
      }
    })(),
  );
});

export {};
