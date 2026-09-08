import { expect, test } from "@playwright/test";
import {
  DEFAULT_PASSWORD,
  DEFAULT_PASSPHRASE,
  registerAndUnlock,
  writeAndSave,
  expectSynced,
  goOnline,
} from "./fixtures";

test("HTTP503 work survives reload and logout before it is acknowledged", async ({
  page,
}) => {
  const email = `refused-${Date.now()}@example.test`;
  await registerAndUnlock(
    page,
    email,
    DEFAULT_PASSWORD,
    DEFAULT_PASSPHRASE,
    "create",
  );
  await page.route("**/v1/vaults/*/operations", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({ status: 503, body: "{}" });
    else await route.continue();
  });
  await writeAndSave(page, "# preserved503\n\nunsynced work");
  await expect(page.locator(".sync-pill")).toHaveText("error");
  await page.reload();
  await registerAndUnlock(
    page,
    email,
    DEFAULT_PASSWORD,
    DEFAULT_PASSPHRASE,
    "unlock",
  );
  await page.getByRole("treeitem", { name: "preserved503" }).click();
  await expect(page.getByLabel("Éditeur Markdown")).toContainText(
    "unsynced work",
  );
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(
    page.getByRole("button", { name: "Se connecter" }),
  ).toBeVisible();
  await registerAndUnlock(
    page,
    email,
    DEFAULT_PASSWORD,
    DEFAULT_PASSPHRASE,
    "unlock",
  );
  await page.getByRole("treeitem", { name: "preserved503" }).click();
  await expect(page.getByLabel("Éditeur Markdown")).toContainText(
    "unsynced work",
  );
  await page.unroute("**/v1/vaults/*/operations");
  await goOnline(page);
  await expectSynced(page);
});

test("a lost acknowledgement replays the identical operation and a second client updates automatically", async ({
  browser,
}) => {
  const first = await browser.newContext(),
    second = await browser.newContext();
  try {
    const a = await first.newPage(),
      b = await second.newPage();
    const email = `lostack-${Date.now()}@example.test`;
    await registerAndUnlock(
      a,
      email,
      DEFAULT_PASSWORD,
      DEFAULT_PASSPHRASE,
      "create",
    );
    await writeAndSave(a, "# live note\n\nbase");
    await expectSynced(a);
    await registerAndUnlock(
      b,
      email,
      DEFAULT_PASSWORD,
      DEFAULT_PASSPHRASE,
      "unlock",
    );
    await b.getByRole("treeitem", { name: "live note" }).click();
    let original = "";
    let replay = "";
    let committed = false;
    await a.route("**/v1/vaults/*/operations", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      if (!committed) {
        original = route.request().postData()!;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        committed = true;
        await route.abort("failed");
      } else {
        replay = route.request().postData()!;
        await route.continue();
      }
    });
    await writeAndSave(a, "# live note\n\nafter lost acknowledgement");
    await expect.poll(() => committed).toBe(true);
    await expect(b.getByLabel("Éditeur Markdown")).toContainText(
      "after lost acknowledgement",
      { timeout: 30000 },
    );
    await goOnline(a);
    await expectSynced(a);
    expect(replay).toBe(original);
    const ops = await a.request.get(
      `/v1/vaults/${JSON.parse(original).vault_id}/operations?limit=100`,
    );
    const body = await ops.json();
    expect(
      body.operations.filter(
        (operation: { operation_id: string }) =>
          operation.operation_id === JSON.parse(original).operation_id,
      ),
    ).toHaveLength(1);
  } finally {
    await first.close();
    await second.close();
  }
});
