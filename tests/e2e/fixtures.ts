import { expect, type Page } from "@playwright/test";

export type UnlockMode = "create" | "unlock";

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}@example.test`;
}

export const DEFAULT_PASSWORD = "a secure password";
export const DEFAULT_PASSPHRASE = "local unlock passphrase";

/** Register or log in, then unlock (or create) the vault with the local passphrase. */
export async function registerAndUnlock(
  page: Page,
  email: string,
  password: string,
  passphrase: string,
  mode: UnlockMode,
): Promise<void> {
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

export async function writeAndSave(page: Page, text: string): Promise<void> {
  const editor = page.getByLabel("Éditeur Markdown");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
  await page.getByRole("button", { name: "Enregistrer" }).click();
}

export async function expectSynced(page: Page): Promise<void> {
  await expect(page.getByRole("status")).toHaveText("synced", {
    timeout: 30_000,
  });
}

export async function expectOffline(page: Page): Promise<void> {
  await expect(page.getByRole("status")).toHaveText("offline", {
    timeout: 30_000,
  });
}

export async function goOnline(page: Page): Promise<void> {
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}
