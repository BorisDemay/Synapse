import { expect, test, type Page } from "@playwright/test";

async function registerAndUnlock(
  page: Page,
  email: string,
  password: string,
  passphrase: string,
  mode: "create" | "unlock",
) {
  if (mode === "create") {
    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: "S’inscrire" }).click();
    await expect(
      page.getByRole("heading", { name: "Créer un coffre" }),
    ).toBeVisible({ timeout: 30_000 });
  } else {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(
      page.getByRole("heading", { name: "Déverrouiller le coffre" }),
    ).toBeVisible({ timeout: 30_000 });
  }
  await page.getByLabel("Phrase de déchiffrement").fill(passphrase);
  await page
    .getByRole("button", {
      name: mode === "create" ? "Créer et déverrouiller" : "Déverrouiller",
    })
    .click();
  await expect(page.getByRole("heading", { name: "Coffre" })).toBeVisible({
    timeout: 30_000,
  });
}

async function writeAndSave(page: Page, text: string) {
  const editor = page.getByLabel("Éditeur Markdown");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
  await page.getByRole("button", { name: "Enregistrer" }).click();
}

test("two offline contexts resolve a concurrent note conflict", async ({
  browser,
}) => {
  const email = `conflict-${Date.now()}@example.test`;
  const password = "a secure password";
  const passphrase = "local unlock passphrase";

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await registerAndUnlock(pageA, email, password, passphrase, "create");
  await writeAndSave(pageA, "# shared seed\n\ncommon");
  await expect(pageA.getByRole("status")).toHaveText("synced", {
    timeout: 30_000,
  });

  await registerAndUnlock(pageB, email, password, passphrase, "unlock");
  await expect(pageB.getByRole("treeitem", { name: "shared seed" })).toBeVisible(
    { timeout: 30_000 },
  );
  await pageB.getByRole("treeitem", { name: "shared seed" }).click();

  await contextA.setOffline(true);
  await writeAndSave(pageA, "# local branch\n\nfrom A");
  await expect(pageA.getByRole("status")).toHaveText("offline", {
    timeout: 30_000,
  });

  await writeAndSave(pageB, "# remote branch\n\nfrom B");
  await expect(pageB.getByRole("status")).toHaveText("synced", {
    timeout: 30_000,
  });

  await contextA.setOffline(false);
  await pageA.evaluate(() => window.dispatchEvent(new Event("online")));
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
  await expect(pageA.getByRole("status")).toHaveText("synced", {
    timeout: 30_000,
  });
  await expect(pageA.getByLabel("Aperçu Markdown")).toContainText("local branch");

  await contextA.close();
  await contextB.close();
});
