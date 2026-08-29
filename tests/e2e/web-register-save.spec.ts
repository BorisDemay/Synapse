import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
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

  const signup = await page.request.post("/auth/signup", {
    data: { email, password },
  });
  expect(signup.status()).toBe(201);

  const mailPath = join(
    process.cwd(),
    "target",
    "e2e-smoke",
    "mail",
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
  const token = new URL(activationLink).searchParams.get("token");
  expect(token).toBeTruthy();
  const activation = await page.request.post("/auth/activate", {
    data: { token },
  });
  expect(activation.status()).toBe(204);

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
  const editor = page.locator('.vditor [contenteditable="true"]:visible');
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("# hello from playwright\n\nRendered body");
  await expect(editor).toContainText("hello from playwright");

  await page.keyboard.press("Control+A");
  await page.keyboard.type(
    "![image](https://attacker.invalid/private-markdown-media.png)",
  );
  await expect(editor.locator('img[alt="image"]')).toHaveCount(1);
  await page.waitForTimeout(1_000);
  expect(attemptedRemoteMedia).toBe(0);

  await expect(page.locator('.sync-pill[data-status="synced"]')).toHaveText(
    "synced",
    { timeout: 30_000 },
  );
});
