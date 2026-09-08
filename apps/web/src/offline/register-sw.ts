export function registerAssetServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  const register = () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Asset caching is best-effort; sync still uses the network/outbox.
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
