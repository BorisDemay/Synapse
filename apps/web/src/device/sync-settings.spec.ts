import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SYNC_RETRY_SECONDS,
  MAX_SYNC_RETRY_SECONDS,
  MIN_SYNC_RETRY_SECONDS,
  readSyncRetrySeconds,
  writeSyncRetrySeconds,
} from "./sync-settings";

describe("device sync retry setting", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to ten seconds and ignores vault-shaped secrets", () => {
    expect(DEFAULT_SYNC_RETRY_SECONDS).toBe(10);
    expect(readSyncRetrySeconds()).toBe(10);
    expect(JSON.stringify(window.localStorage)).not.toContain("passphrase");
  });

  it("clamps the stored interval to a bounded device setting", () => {
    writeSyncRetrySeconds(1);
    expect(readSyncRetrySeconds()).toBe(MIN_SYNC_RETRY_SECONDS);
    writeSyncRetrySeconds(120);
    expect(readSyncRetrySeconds()).toBe(MAX_SYNC_RETRY_SECONDS);
    writeSyncRetrySeconds(15);
    expect(readSyncRetrySeconds()).toBe(15);
  });
});
