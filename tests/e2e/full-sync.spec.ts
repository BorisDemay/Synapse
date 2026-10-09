import { expect, test } from "@playwright/test";

import {
  DEFAULT_PASSPHRASE,
  DEFAULT_PASSWORD,
  expectOffline,
  expectSynced,
  goOnline,
  registerAndUnlock,
  uniqueEmail,
  writeAndSave,
} from "./fixtures";

/**
 * Vertical path: client A (browser A) → server → client B (web) →
 * offline conflict → resolve → persistence across reload.
 */
test("full encrypted sync path survives conflict and reload", async ({
  browser,
}) => {
  const email = uniqueEmail("full-sync");
  const password = DEFAULT_PASSWORD;
  const passphrase = DEFAULT_PASSPHRASE;

  const firstClient = await browser.newContext();
  const web = await browser.newContext();
  const firstPage = await firstClient.newPage();
  const webPage = await web.newPage();

  await registerAndUnlock(firstPage, email, password, passphrase, "create");
  await writeAndSave(firstPage, "# vertical seed\n\nfrom browser A");
  await expectSynced(firstPage);

  await registerAndUnlock(webPage, email, password, passphrase, "unlock");
  await expect(
    webPage.getByRole("treeitem", { name: "vertical seed" }),
  ).toBeVisible({ timeout: 30_000 });
  await webPage.getByRole("treeitem", { name: "vertical seed" }).click();
  await expect(webPage.getByLabel("Éditeur Markdown")).toContainText(
    "from browser A",
    { timeout: 30_000 },
  );

  await writeAndSave(webPage, "# vertical seed\n\nweb edit online");
  await expectSynced(webPage);

  await firstClient.setOffline(true);
  await writeAndSave(firstPage, "# vertical seed\n\nbrowser A offline edit");
  await expectOffline(firstPage);

  await writeAndSave(webPage, "# vertical seed\n\nweb concurrent edit");
  await expectSynced(webPage);

  await goOnline(firstPage);
  await expect(
    firstPage.getByRole("region", { name: "Résolution de conflit" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    firstPage.getByLabel("Version locale", { exact: true }),
  ).toContainText("browser A offline edit");
  await expect(
    firstPage.getByLabel("Version distante", { exact: true }),
  ).toContainText("web concurrent edit");

  firstPage.once("dialog", (dialog) => dialog.accept());
  await firstPage
    .getByRole("button", { name: "Garder la version locale" })
    .click();
  await expectSynced(firstPage);
  await expect(firstPage.getByLabel("Éditeur Markdown")).toContainText(
    "browser A offline edit",
  );

  await firstPage.reload();
  await registerAndUnlock(firstPage, email, password, passphrase, "unlock");
  await expect(
    firstPage.getByRole("treeitem", { name: "vertical seed" }),
  ).toBeVisible({ timeout: 30_000 });
  await firstPage.getByRole("treeitem", { name: "vertical seed" }).click();
  await expect(firstPage.getByLabel("Éditeur Markdown")).toContainText(
    "browser A offline edit",
    { timeout: 30_000 },
  );

  await firstClient.close();
  await web.close();
});
