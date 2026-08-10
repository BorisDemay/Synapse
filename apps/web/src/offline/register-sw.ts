export function registerAssetServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Asset caching is best-effort; sync still uses the network/outbox.
    });
  });
}
