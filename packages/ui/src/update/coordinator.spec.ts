import { describe, expect, it, vi } from "vitest";

import { createUpdateCoordinator, type UpdateMetadata } from "./coordinator";

const update: UpdateMetadata = {
  commitSha: "a".repeat(40),
  publishedAt: "2026-08-31T12:00:00Z",
  releaseNotes: "Corrections de fiabilite",
  version: "0.1.42",
};

describe("update coordinator", () => {
  it("deduplique les verifications concurrentes", async () => {
    let resolveCheck!: (value: UpdateMetadata | null) => void;
    const check = vi.fn(
      () =>
        new Promise<UpdateMetadata | null>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const coordinator = createUpdateCoordinator({ check, apply: vi.fn() });

    const first = coordinator.check();
    const second = coordinator.check();
    resolveCheck(update);
    await Promise.all([first, second]);

    expect(check).toHaveBeenCalledOnce();
    expect(coordinator.snapshot.value).toMatchObject({
      metadata: update,
      state: "ready",
    });
  });

  it("telecharge une version native une seule fois et expose la progression", async () => {
    const prepare = vi.fn(
      async (_metadata, progress: (value: number) => void) => {
        progress(0.25);
        progress(1);
      },
    );
    const coordinator = createUpdateCoordinator({
      apply: vi.fn(),
      check: vi.fn().mockResolvedValue(update),
      prepare,
    });

    await coordinator.check();
    await coordinator.check();

    expect(prepare).toHaveBeenCalledOnce();
    expect(coordinator.snapshot.value).toMatchObject({
      metadata: update,
      progress: 1,
      state: "ready",
    });
  });

  it("garde les erreurs non bloquantes et permet un nouvel essai", async () => {
    const check = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null);
    const coordinator = createUpdateCoordinator({ apply: vi.fn(), check });

    await coordinator.check();
    expect(coordinator.snapshot.value).toMatchObject({
      error: "offline",
      state: "error",
    });
    await coordinator.check();
    expect(coordinator.snapshot.value).toMatchObject({ state: "idle" });
  });

  it("applique seulement une mise a jour prete", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const coordinator = createUpdateCoordinator({
      apply,
      check: vi.fn().mockResolvedValue(update),
    });

    await coordinator.apply();
    expect(apply).not.toHaveBeenCalled();
    await coordinator.check();
    await coordinator.apply();

    expect(apply).toHaveBeenCalledWith(update);
    expect(coordinator.snapshot.value.state).toBe("applying");
  });
});
