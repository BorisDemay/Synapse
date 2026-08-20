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

test("two offline contexts resolve a concurrent note conflict", async ({
  browser,
}) => {
  const email = uniqueEmail("conflict");
  const password = DEFAULT_PASSWORD;
  const passphrase = DEFAULT_PASSPHRASE;

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await registerAndUnlock(pageA, email, password, passphrase, "create");
  await writeAndSave(pageA, "# shared seed\n\ncommon");
  await expectSynced(pageA);

  await registerAndUnlock(pageB, email, password, passphrase, "unlock");
  await expect(pageB.getByRole("treeitem", { name: "shared seed" })).toBeVisible(
    { timeout: 30_000 },
  );
  await pageB.getByRole("treeitem", { name: "shared seed" }).click();

  await contextA.setOffline(true);
  await writeAndSave(pageA, "# local branch\n\nfrom A");
  await expectOffline(pageA);

  await writeAndSave(pageB, "# remote branch\n\nfrom B");
  await expectSynced(pageB);

  await goOnline(pageA);
  await expect(
    pageA.getByRole("region", { name: "Résolution de conflit" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(pageA.getByLabel("Version locale", { exact: true })).toContainText(
    "local branch",
  );
  await expect(
    pageA.getByLabel("Version distante", { exact: true }),
  ).toContainText("remote branch");

  pageA.once("dialog", (dialog) => dialog.accept());
  await pageA.getByRole("button", { name: "Garder la version locale" }).click();
  await expectSynced(pageA);
  await expect(pageA.getByLabel("Éditeur Markdown")).toContainText("local branch");

  await contextA.close();
  await contextB.close();
});
