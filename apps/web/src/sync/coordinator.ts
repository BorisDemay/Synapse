import { watch } from "vue";
import { readSyncRetrySeconds } from "../device/sync-settings";
import type { useAuthStore } from "../stores/auth";
import type { useVaultStore } from "../stores/vault";

export function createSyncLoop(options: {
  sync: () => Promise<boolean>;
  retrySeconds: () => number;
  random?: () => number;
}) {
  let stopped = false;
  let running = false;
  let requested = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function run() {
    if (stopped) return;
    if (running) {
      requested = true;
      return;
    }
    clearTimeout(timer);
    running = true;
    requested = false;
    let ok = false;
    try {
      ok = await options.sync();
    } catch {
      /* Retry without exposing request details. */
    }
    running = false;
    if (stopped) return;
    failures = ok ? 0 : Math.min(failures + 1, 5);
    const delay = Math.min(
      60000,
      Math.max(
        3000,
        options.retrySeconds() *
          1000 *
          2 ** Math.max(0, failures - 1) *
          (0.8 + (options.random ?? Math.random)() * 0.4),
      ),
    );
    timer = setTimeout(() => void run(), ok && requested ? 0 : delay);
  }
  return {
    wake: () => {
      void run();
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/** WebSockets only wake a durable pull; native clients use the authenticated HTTP bridge. */
export function startSyncCoordinator(
  auth: ReturnType<typeof useAuthStore>,
  vault: ReturnType<typeof useVaultStore>,
  options: { websocket?: boolean } = {},
): () => void {
  let dispose: (() => void) | undefined;
  const unwatch = watch(
    () =>
      [
        auth.userId,
        auth.isAuthenticated,
        auth.isLocalMode,
        vault.currentVaultId,
        vault.isUnlocked,
      ] as const,
    ([, authenticated, local, vaultId, unlocked]) => {
      dispose?.();
      dispose = undefined;
      vault.setSyncWakeup();
      if (!authenticated || local || !vaultId || !unlocked) return;
      let socket: WebSocket | undefined;
      let stopped = false;
      const loop = createSyncLoop({
        retrySeconds: readSyncRetrySeconds,
        sync: async () => {
          connect();
          return vault.synchronize();
        },
      });
      function connect() {
        if (
          stopped ||
          options.websocket === false ||
          typeof WebSocket === "undefined" ||
          socket
        )
          return;
        try {
          const url = new URL(
            `/v1/vaults/${vaultId}/ws`,
            window.location.origin,
          );
          url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
          socket = new WebSocket(url);
          socket.onopen = () => loop.wake();
          socket.onmessage = (event) => {
            try {
              const notice: unknown = JSON.parse(String(event.data));
              if (
                notice &&
                typeof notice === "object" &&
                "vault_id" in notice &&
                notice.vault_id === vaultId &&
                "cursor" in notice &&
                typeof notice.cursor === "string"
              )
                loop.wake();
            } catch {
              /* Notifications are untrusted hints, never cursor acknowledgements. */
            }
          };
          socket.onclose = () => {
            socket = undefined;
          };
          socket.onerror = () => {
            socket?.close();
          };
        } catch {
          socket = undefined;
        }
      }
      const wake = () => loop.wake();
      const visible = () => {
        if (document.visibilityState === "visible") wake();
      };
      window.addEventListener("online", wake);
      window.addEventListener("focus", wake);
      document.addEventListener("visibilitychange", visible);
      vault.setSyncWakeup(wake);
      dispose = () => {
        stopped = true;
        loop.stop();
        if (socket) {
          socket.onopen = null;
          socket.onmessage = null;
          socket.onclose = null;
          socket.onerror = null;
          socket.close();
        }
        window.removeEventListener("online", wake);
        window.removeEventListener("focus", wake);
        document.removeEventListener("visibilitychange", visible);
      };
      loop.wake();
    },
    { immediate: true },
  );
  return () => {
    unwatch();
    dispose?.();
    vault.setSyncWakeup();
  };
}
