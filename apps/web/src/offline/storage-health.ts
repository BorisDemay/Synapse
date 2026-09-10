import { openOfflineDb } from "./db";

export interface BrowserStorageHealth {
  availableBytes: number | null;
  lastSuccessfulBackup: string | null;
  pendingOperationCount: number;
  persistent: boolean;
  quotaBytes: number | null;
  serverPendingOperationCount: number | null;
  serverUsedBytes: number | null;
  usageBytes: number | null;
}

/** Ask the browser to keep the ciphertext cache and outbox across eviction. */
export async function requestPersistentBrowserStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function readBrowserStorageHealth(
  userId: string,
): Promise<BrowserStorageHealth> {
  const db = await openOfflineDb();
  const queued = await db.getAll("queue");
  const pendingOperationCount = queued.filter(
    (operation) => operation.userId === userId && !operation.supersededBy,
  ).length;
  const storage =
    typeof navigator === "undefined" ? undefined : navigator.storage;
  const estimate = storage?.estimate
    ? await storage.estimate().catch(() => undefined)
    : undefined;
  const persistent = storage?.persisted
    ? await storage.persisted().catch(() => false)
    : false;
  let server: Partial<BrowserStorageHealth> = {};
  try {
    const response = await fetch("/health/storage", { credentials: "include" });
    if (response.ok) {
      const body = (await response.json()) as Record<string, unknown>;
      server = {
        availableBytes:
          typeof body.available_bytes === "number"
            ? body.available_bytes
            : undefined,
        lastSuccessfulBackup:
          typeof body.last_successful_backup === "string"
            ? body.last_successful_backup
            : null,
        serverPendingOperationCount:
          typeof body.pending_operation_count === "number"
            ? body.pending_operation_count
            : undefined,
        serverUsedBytes:
          typeof body.used_bytes === "number" ? body.used_bytes : undefined,
        quotaBytes:
          typeof body.quota_bytes === "number" ? body.quota_bytes : undefined,
      };
    }
  } catch {
    // Offline use still reports the local IndexedDB estimate and outbox.
  }
  return {
    availableBytes:
      server.availableBytes ??
      (typeof estimate?.quota === "number" && typeof estimate.usage === "number"
        ? Math.max(0, estimate.quota - estimate.usage)
        : null),
    lastSuccessfulBackup: server.lastSuccessfulBackup ?? null,
    pendingOperationCount,
    persistent: persistent === true,
    quotaBytes:
      server.quotaBytes ??
      (typeof estimate?.quota === "number" ? estimate.quota : null),
    serverPendingOperationCount: server.serverPendingOperationCount ?? null,
    serverUsedBytes: server.serverUsedBytes ?? null,
    usageBytes: typeof estimate?.usage === "number" ? estimate.usage : null,
  };
}
