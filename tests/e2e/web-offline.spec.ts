import { expect, test } from "@playwright/test";
import { registerAndUnlock, writeAndSave } from "./fixtures";

test("edits offline then syncs the encrypted outbox after reconnect", async ({
  context,
  page,
}) => {
  const email = `offline-${Date.now()}@example.test`;
  const password = "a secure password";
  const passphrase = "local unlock passphrase";

  await registerAndUnlock(page, email, password, passphrase, "create");

  await writeAndSave(page, "# online seed\n\nbody");
  await expect(page.locator(".sync-pill")).toHaveText("synced", {
    timeout: 30000,
  });

  await context.setOffline(true);
  await writeAndSave(page, "# offline edit\n\nstill local");
  await expect(page.locator(".sync-pill")).toHaveText("offline", {
    timeout: 30_000,
  });
  await expect(page.getByLabel("Éditeur Markdown")).toContainText(
    "offline edit",
  );

  await context.setOffline(false);
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.locator(".sync-pill")).toHaveText("synced", {
    timeout: 30_000,
  });
});

test("a fresh browser process reopens an offline encrypted edit from the cached application", async ({
  playwright,
}) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const profile = await mkdtemp(join(tmpdir(), "synapse-browser-profile-"));
  const baseURL = `http://127.0.0.1:${process.env.SYNAPSE_E2E_UI_PORT ?? 15173}`;
  let context = await playwright.chromium.launchPersistentContext(profile, {
    headless: true,
    baseURL,
  });
  try {
    let page = await context.newPage();
    await registerAndUnlock(
      page,
      `restart-${Date.now()}@example.test`,
      "a secure password",
      "local unlock passphrase",
      "create",
    );
    await writeAndSave(page, "# restart note\n\nonline base");
    await expect(page.locator(".sync-pill")).toHaveText("synced");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true);
    const cached = await page.evaluate(async () => {
      const result: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          result.push(request.url);
          const response = await cache.match(request);
          if (response?.url) result.push(response.url);
        }
      }
      return result;
    });
    expect(
      cached.some((url) => /\/(auth|v1|vaults)(\/|\?)|[?&]token=/.test(url)),
    ).toBe(false);
    await context.setOffline(true);
    await writeAndSave(page, "# restart note\n\noffline durable edit");
    await expect(page.locator(".sync-pill")).toHaveText("offline");
    await context.close();
    context = await playwright.chromium.launchPersistentContext(profile, {
      headless: true,
      baseURL,
      offline: true,
    });
    page = await context.newPage();
    await page.goto("/vault");
    await page
      .getByLabel("Phrase de déchiffrement")
      .fill("local unlock passphrase");
    await page
      .getByRole("button", { name: "Déverrouiller", exact: true })
      .click();
    await page.getByRole("treeitem", { name: "restart note" }).click();
    await expect(page.getByLabel("Éditeur Markdown")).toContainText(
      "offline durable edit",
    );
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator(".sync-pill")).toHaveText("synced", {
      timeout: 30000,
    });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
