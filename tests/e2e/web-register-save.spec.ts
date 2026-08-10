import { expect, test } from "@playwright/test";

test("registers, creates a vault, and saves an encrypted note", async ({
  page,
}) => {
  const email = `e2e-${Date.now()}@example.test`;
  const password = "a secure password";
  const passphrase = "local unlock passphrase";

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "S’inscrire" }).click();

  await expect(
    page.getByRole("heading", { name: "Créer un coffre" }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel("Phrase de déchiffrement").fill(passphrase);
  await page.getByRole("button", { name: "Créer et déverrouiller" }).click();

  await expect(page.getByRole("heading", { name: "Coffre" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByLabel("Aperçu Markdown")).toBeVisible();

  const editor = page.getByLabel("Éditeur Markdown");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("line one\nline two");

  const preview = page.getByLabel("Aperçu Markdown");
  await expect(preview).toContainText("line one");
  await expect(preview).toContainText("line two");
  await expect(preview.locator("br")).toHaveCount(1, { timeout: 10_000 });

  await page.keyboard.press("Control+A");
  await page.keyboard.type("# hello from playwright\n\nRendered body");
  await expect(
    preview.getByRole("heading", { name: "hello from playwright" }),
  ).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status")).toHaveText("synced", {
    timeout: 30_000,
  });
});
