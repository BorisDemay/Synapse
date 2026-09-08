import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { writeAndSave, expectSynced } from "./fixtures";
import { join } from "node:path";

test("registers, creates a vault, and saves an encrypted note", async ({
  page,
}) => {
  let attemptedRemoteMedia = 0;
  await page.route("https://attacker.invalid/**", async (route) => {
    attemptedRemoteMedia += 1;
    await route.abort();
  });

  const email = `e2e-${Date.now()}@example.test`;
  const password = "a secure password";
  const passphrase = "local unlock passphrase";

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "S’inscrire" }).click();
  await expect(page.getByRole("status")).toContainText("lien d’activation");

  const mailPath = join(
    process.env.SYNAPSE_E2E_MAIL_DIRECTORY!,
    `${email}.eml`,
  );
  await expect
    .poll(
      async () => {
        try {
          return await readFile(mailPath, "utf8");
        } catch {
          return "";
        }
      },
      { timeout: 30_000 },
    )
    .toContain(`To: ${email}`);
  const activationMail = await readFile(mailPath, "utf8");
  const activationLink = activationMail.match(/https?:\/\/\S+/)?.[0];
  expect(activationLink).toBeDefined();
  await page.goto(activationLink!);
  await page.getByRole("button", { name: "Activer le compte" }).click();
  await expect(page.getByRole("status")).toContainText("Compte activé");
  await expect(page).not.toHaveURL(/token=/);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();

  await expect(
    page.getByRole("heading", { name: "Créer un coffre" }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel("Phrase de déchiffrement").fill(passphrase);
  await page.getByRole("button", { name: "Créer et déverrouiller" }).click();

  await expect(
    page.getByRole("heading", { name: "Coffre", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await writeAndSave(page, "# hello from playwright\n\nRendered body");
  await expectSynced(page);
  await writeAndSave(
    page,
    "![image](https://attacker.invalid/private-markdown-media.png)",
  );
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const editor = page.getByLabel("Éditeur Markdown");
  await expect(editor.locator('img[alt="image"]')).toHaveCount(1);
  await expectSynced(page);
  expect(attemptedRemoteMedia).toBe(0);
});
