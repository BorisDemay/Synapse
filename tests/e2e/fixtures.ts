import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { persistedMarkdown } from "./durable-cache";
import { join } from "node:path";

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
    const signup = await page.request.post("/auth/signup", {
      data: { email, password },
    });
    expect(signup.status()).toBe(201);
    const mailPath = join(
      process.env.SYNAPSE_E2E_MAIL_DIRECTORY!,
      `${email}.eml`,
    );
    await expect
      .poll(async () => readFile(mailPath, "utf8").catch(() => ""), {
        timeout: 30_000,
      })
      .toContain(`To: ${email}`);
    const mail = await readFile(mailPath, "utf8");
    const link = mail.match(/https?:\/\/\S+/)?.[0];
    expect(link).toBeDefined();
    const token = new URL(link!).searchParams.get("token");
    expect(
      (await page.request.post("/auth/activate", { data: { token } })).status(),
    ).toBe(204);
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(
      page.getByRole("heading", { name: "Créer un coffre" }),
    ).toBeVisible({ timeout: 30_000 });
  } else {
    await page.goto("/login");
    const login = page.getByRole("button", { name: "Se connecter" });
    const unlock = page.getByRole("heading", {
      name: "Déverrouiller le coffre",
    });
    await expect(login.or(unlock)).toBeVisible({ timeout: 30000 });
    if (await login.isVisible()) {
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Mot de passe").fill(password);
      await login.click();
    }
    await expect(unlock).toBeVisible({ timeout: 30000 });
  }
  await page
    .getByLabel("Phrase de déchiffrement", { exact: true })
    .fill(passphrase);
  if (mode === "create") {
    await page
      .getByLabel("Confirmer la phrase de déchiffrement", { exact: true })
      .fill(passphrase);
  }
  await page
    .getByRole("button", {
      name: mode === "create" ? "Créer et déverrouiller" : "Déverrouiller",
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Coffre", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
}

export async function writeAndSave(page: Page, text: string): Promise<void> {
  // The accessible label also exists on the mount point while Vditor loads.
  await expect(
    page.getByRole("textbox", { name: "Éditeur Markdown" }),
  ).toBeEditable();
  await page.getByRole("button", { name: "Texte brut", exact: true }).click();
  const editor = page.locator('.vditor-sv[contenteditable="true"]');
  await expect(editor).toBeVisible();
  // Paste source text through the editor's supported multiline input path.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+V");
  await expect
    .poll(() => persistedMarkdown(page, DEFAULT_PASSPHRASE), { timeout: 30000 })
    .toContain(text.trim());
}

export async function expectSynced(page: Page): Promise<void> {
  await expect(page.locator(".sync-pill")).toHaveAttribute(
    "data-status",
    "synced",
    {
      timeout: 30_000,
    },
  );
}

export async function expectOffline(page: Page): Promise<void> {
  await expect(page.locator(".sync-pill")).toHaveAttribute(
    "data-status",
    "offline",
    {
      timeout: 30_000,
    },
  );
}

export async function goOnline(page: Page): Promise<void> {
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}
