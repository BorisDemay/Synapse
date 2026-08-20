import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import path from "node:path";

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

const root = path.resolve(__dirname, "../..");

/**
 * Vertical path: client A (desktop stand-in) → server → client B (web) →
 * offline conflict → resolve → persistence across reload.
 * Optional Compose backup/restore when SYNAPSE_RUN_BACKUP_E2E=1.
 */
test("full encrypted sync path survives conflict and reload", async ({
  browser,
}) => {
  const email = uniqueEmail("full-sync");
  const password = DEFAULT_PASSWORD;
  const passphrase = DEFAULT_PASSPHRASE;

  const desktop = await browser.newContext();
  const web = await browser.newContext();
  const desktopPage = await desktop.newPage();
  const webPage = await web.newPage();

  await registerAndUnlock(desktopPage, email, password, passphrase, "create");
  await writeAndSave(desktopPage, "# vertical seed\n\nfrom desktop stand-in");
  await expectSynced(desktopPage);

  await registerAndUnlock(webPage, email, password, passphrase, "unlock");
  await expect(
    webPage.getByRole("treeitem", { name: "vertical seed" }),
  ).toBeVisible({ timeout: 30_000 });
  await webPage.getByRole("treeitem", { name: "vertical seed" }).click();
  await expect(webPage.getByLabel("Éditeur Markdown")).toContainText(
    "from desktop stand-in",
    { timeout: 30_000 },
  );

  await writeAndSave(webPage, "# vertical seed\n\nweb edit online");
  await expectSynced(webPage);

  await desktop.setOffline(true);
  await writeAndSave(desktopPage, "# vertical seed\n\ndesktop offline edit");
  await expectOffline(desktopPage);

  await writeAndSave(webPage, "# vertical seed\n\nweb concurrent edit");
  await expectSynced(webPage);

  await goOnline(desktopPage);
  await expect(
    desktopPage.getByRole("region", { name: "Résolution de conflit" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    desktopPage.getByLabel("Version locale", { exact: true }),
  ).toContainText("desktop offline edit");
  await expect(
    desktopPage.getByLabel("Version distante", { exact: true }),
  ).toContainText("web concurrent edit");

  desktopPage.once("dialog", (dialog) => dialog.accept());
  await desktopPage
    .getByRole("button", { name: "Garder la version locale" })
    .click();
  await expectSynced(desktopPage);
  await expect(desktopPage.getByLabel("Éditeur Markdown")).toContainText(
    "desktop offline edit",
  );

  await desktopPage.reload();
  await registerAndUnlock(desktopPage, email, password, passphrase, "unlock");
  await expect(
    desktopPage.getByRole("treeitem", { name: "vertical seed" }),
  ).toBeVisible({ timeout: 30_000 });
  await desktopPage.getByRole("treeitem", { name: "vertical seed" }).click();
  await expect(desktopPage.getByLabel("Éditeur Markdown")).toContainText(
    "desktop offline edit",
    { timeout: 30_000 },
  );

  await desktop.close();
  await web.close();
});

test("optional compose backup restore when enabled", async () => {
  test.skip(
    process.env.SYNAPSE_RUN_BACKUP_E2E !== "1",
    "Set SYNAPSE_RUN_BACKUP_E2E=1 to run Compose backup/restore in this suite",
  );
  const result = spawnSync("bash", ["tests/integration/backup_restore.sh"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
});
