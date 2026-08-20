import { expect, test } from "@playwright/test";

test("edits offline then syncs the encrypted outbox after reconnect", async ({
  context,
  page,
}) => {
  const email = `offline-${Date.now()}@example.test`;
  const password = "a secure password";
  const passphrase = "local unlock passphrase";

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "S’inscrire" }).click();

  await expect(
    page.getByRole("heading", { name: "Créer un coffre" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Phrase de déchiffrement").fill(passphrase);
  await page.getByRole("button", { name: "Créer et déverrouiller" }).click();
  await expect(
    page.getByRole("heading", { name: "Coffre", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });

  const editor = page.getByLabel("Éditeur Markdown");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("# online seed\n\nbody");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status")).toHaveText("synced", {
    timeout: 30_000,
  });

  await context.setOffline(true);
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("# offline edit\n\nstill local");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status")).toHaveText("offline", {
    timeout: 30_000,
  });
  await expect(page.getByLabel("Éditeur Markdown")).toContainText("offline edit");

  await context.setOffline(false);
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.getByRole("status")).toHaveText("synced", {
    timeout: 30_000,
  });
});
