import { describe, expect, it, vi } from "vitest";

import {
  createUpdateCoordinator,
  startUpdateChecks,
  type UpdateMetadata,
} from "./coordinator";

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

    expect(apply).toHaveBeenCalledWith(update, expect.any(Function));
    expect(coordinator.snapshot.value.state).toBe("applying");
  });

  it("expose les etapes d'application signalees par le fournisseur", async () => {
    const apply = vi.fn(
      async (_metadata: UpdateMetadata, onStatus: (status: string) => void) => {
        onStatus("Activation de la mise à jour…");
      },
    );
    const coordinator = createUpdateCoordinator({
      apply,
      check: vi.fn().mockResolvedValue(update),
    });

    await coordinator.check();
    await coordinator.apply();

    expect(coordinator.snapshot.value.status).toBe(
      "Activation de la mise à jour…",
    );
  });

  it("affiche une etape par defaut des le debut de l'application", async () => {
    let release!: () => void;
    const apply = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const coordinator = createUpdateCoordinator({
      apply,
      check: vi.fn().mockResolvedValue(update),
    });

    await coordinator.check();
    const applying = coordinator.apply();

    expect(coordinator.snapshot.value.status).toBe(
      "Application de la mise à jour…",
    );

    release();
    await applying;
  });
});

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fakeTarget() {
  const listeners = new Map<string, Set<() => void>>();
  let interval: (() => void) | null = null;
  return {
    addEventListener(type: string, handler: () => void) {
      const handlers = listeners.get(type) ?? new Set<() => void>();
      handlers.add(handler);
      listeners.set(type, handlers);
    },
    removeEventListener(type: string, handler: () => void) {
      listeners.get(type)?.delete(handler);
    },
    setInterval(handler: () => void) {
      interval = handler;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval() {
      interval = null;
    },
    dispatch(type: string) {
      for (const handler of listeners.get(type) ?? []) handler();
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
    tick() {
      interval?.();
    },
  };
}

describe("startUpdateChecks", () => {
  it("verifie au demarrage puis sur focus, online et a l'intervalle", async () => {
    const check = vi.fn().mockResolvedValue(null);
    const coordinator = createUpdateCoordinator({ apply: vi.fn(), check });
    const target = fakeTarget();

    const stop = startUpdateChecks(
      coordinator,
      target as unknown as Window,
      60_000,
    );
    await settle();
    expect(check).toHaveBeenCalledTimes(1);

    target.dispatch("focus");
    await settle();
    expect(check).toHaveBeenCalledTimes(2);

    target.dispatch("online");
    await settle();
    expect(check).toHaveBeenCalledTimes(3);

    target.tick();
    await settle();
    expect(check).toHaveBeenCalledTimes(4);

    stop();
    target.dispatch("focus");
    target.tick();
    await settle();
    expect(check).toHaveBeenCalledTimes(4);
    expect(target.count("focus")).toBe(0);
    expect(target.count("online")).toBe(0);
  });
});
