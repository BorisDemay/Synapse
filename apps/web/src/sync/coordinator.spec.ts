import { afterEach, expect, it, vi } from "vitest";
import { createSyncLoop } from "./coordinator";
afterEach(() => vi.useRealTimers());
it("coalesces wakeups and retries with bounded delay then stops cleanly", async () => {
  vi.useFakeTimers();
  let release!: (ok: boolean) => void;
  const sync = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(true);
  const loop = createSyncLoop({
    sync,
    retrySeconds: () => 3,
    random: () => 0.5,
  });
  loop.wake();
  loop.wake();
  expect(sync).toHaveBeenCalledTimes(1);
  release(false);
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(3000);
  expect(sync).toHaveBeenCalledTimes(2);
  loop.stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(sync).toHaveBeenCalledTimes(2);
});
it("uses socket hints only to wake durable sync and closes on lock", async () => {
  const { reactive, nextTick } = await import("vue");
  const { startSyncCoordinator } = await import("./coordinator");
  vi.useFakeTimers();
  const sockets: Array<{
    onopen: null | (() => void);
    onmessage: null | ((event: { data: string }) => void);
    onclose: null | (() => void);
    onerror: null | (() => void);
    close: ReturnType<typeof vi.fn>;
  }> = [];
  class Socket {
    onopen = null;
    onmessage = null;
    onclose = null;
    onerror = null;
    close = vi.fn();
    constructor(public url: URL) {
      sockets.push(this);
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  const auth = reactive({
    userId: "user",
    isAuthenticated: true,
    isLocalMode: false,
  });
  const sync = vi.fn().mockResolvedValue(true);
  const vault = reactive({
    currentVaultId: "vault",
    isUnlocked: true,
    synchronize: sync,
    setSyncWakeup: vi.fn(),
  });
  const stop = startSyncCoordinator(auth as never, vault as never);
  await Promise.resolve();
  expect(sync).toHaveBeenCalledTimes(1);
  sockets[0]?.onmessage?.({
    data: JSON.stringify({ vault_id: "other", cursor: "untrusted" }),
  });
  expect(sync).toHaveBeenCalledTimes(1);
  sockets[0]?.onmessage?.({
    data: JSON.stringify({ vault_id: "vault", cursor: "untrusted" }),
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(sync).toHaveBeenCalledTimes(2);
  vault.isUnlocked = false;
  await nextTick();
  expect(sockets[0]?.close).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60000);
  expect(sync).toHaveBeenCalledTimes(2);
  stop();
  vi.unstubAllGlobals();
});
