import { describe, expect, it, vi } from "vitest";

import { createWebUpdateProvider } from "./web-provider";

describe("web update provider", () => {
  const current = { commitSha: "a".repeat(40), version: "0.1.41" };

  it("detecte un web.json plus recent sans le mettre en cache", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          commit_sha: "b".repeat(40),
          pub_date: "2026-08-31T12:00:00Z",
          notes: "Release 42",
          version: "0.1.42",
        }),
        { status: 200 },
      ),
    );
    const provider = createWebUpdateProvider(current, fetcher, vi.fn());

    await expect(provider.check()).resolves.toMatchObject({
      commitSha: "b".repeat(40),
      version: "0.1.42",
    });
    expect(fetcher).toHaveBeenCalledWith("/updates/stable/web.json", {
      cache: "no-store",
      credentials: "omit",
    });
  });

  it("n'affiche rien dans un onglet deja sur le build publie", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          commit_sha: current.commitSha,
          pub_date: "2026-08-31T12:00:00Z",
          notes: "Release 41",
          version: current.version,
        }),
      ),
    );

    await expect(
      createWebUpdateProvider(current, fetcher, vi.fn()).check(),
    ).resolves.toBeNull();
  });

  it("refuse de proposer un retour vers une version inferieure", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          commit_sha: "0".repeat(40),
          pub_date: "2026-08-30T12:00:00Z",
          notes: "Ancienne release",
          version: "0.1.40",
        }),
      ),
    );

    await expect(
      createWebUpdateProvider(current, fetcher, vi.fn()).check(),
    ).resolves.toBeNull();
  });

  it("recharge seulement apres activation explicite", async () => {
    const reload = vi.fn();
    const status = vi.fn();
    const provider = createWebUpdateProvider(current, vi.fn(), reload);

    expect(reload).not.toHaveBeenCalled();
    await provider.apply(
      {
        commitSha: "b".repeat(40),
        publishedAt: "2026-08-31T12:00:00Z",
        releaseNotes: "Release 42",
        version: "0.1.42",
      },
      status,
    );

    expect(reload).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledWith("Rechargement de l’application…");
  });

  it("refuse une metadonnee incomplete", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ version: "0.1.42" })));

    await expect(
      createWebUpdateProvider(current, fetcher, vi.fn()).check(),
    ).rejects.toThrow("invalid web update metadata");
  });
});
