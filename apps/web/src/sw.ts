/// <reference lib="webworker" />

const CACHE = `synapse-assets-${import.meta.env.VITE_SYNAPSE_VERSION ?? "development"}-${import.meta.env.VITE_SYNAPSE_COMMIT_SHA ?? "local"}`;

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
  event.waitUntil(worker.skipWaiting());
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      worker.clients.claim(),
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key !== CACHE)
              .map((key) => caches.delete(key)),
          ),
        ),
    ]),
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
          if (fresh.ok) {
            await cache.put("/index.html", fresh.clone());
          }
          return fresh;
        } catch {
          const fallback = await cache.match("/index.html");
          if (fallback) return fallback;
          throw new Error("offline shell unavailable");
        }
      }

      const cached = await cache.match(request);
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
