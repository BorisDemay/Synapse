const STORAGE_KEY = "synapse-device-sync-retry-seconds";

export const DEFAULT_SYNC_RETRY_SECONDS = 10;
export const MIN_SYNC_RETRY_SECONDS = 3;
export const MAX_SYNC_RETRY_SECONDS = 60;

export function clampSyncRetrySeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SYNC_RETRY_SECONDS;
  }
  return Math.min(
    MAX_SYNC_RETRY_SECONDS,
    Math.max(MIN_SYNC_RETRY_SECONDS, Math.round(value)),
  );
}

export function readSyncRetrySeconds(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_SYNC_RETRY_SECONDS;
    }
    return clampSyncRetrySeconds(Number(raw));
  } catch {
    return DEFAULT_SYNC_RETRY_SECONDS;
  }
}

export function writeSyncRetrySeconds(value: number): number {
  const clamped = clampSyncRetrySeconds(value);
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clamped));
  } catch {
    // Device storage may be unavailable in private mode or tests.
  }
  return clamped;
}
