import { expect, test } from "@playwright/test";

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
  await expect(page.getByLabel("Éditeur Markdown")).toBeVisible();
  await expect(
    page
      .getByRole("toolbar", { name: "Mise en forme Markdown" })
      .getByText("Gras", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() =>
      page
        .getByRole("toolbar", { name: "Mise en forme Markdown" })
        .evaluate((toolbar) => toolbar.scrollWidth <= toolbar.clientWidth),
    )
    .toBe(true);
  await expect(
    page
      .getByRole("toolbar", { name: "Mise en forme Markdown" })
      .evaluate((toolbar) => getComputedStyle(toolbar).justifyContent),
  ).resolves.toBe("center");
  await expect
    .poll(() =>
      page
        .getByRole("toolbar", { name: "Mise en forme Markdown" })
        .evaluate((toolbar) => {
          const items = [
            ...toolbar.querySelectorAll<HTMLElement>(".vditor-toolbar__item"),
          ];
          if (items.length === 0) {
            return Number.POSITIVE_INFINITY;
          }

          const bar = toolbar.getBoundingClientRect();
          const rowTop = items[0].getBoundingClientRect().top;
          const rowItems = items.filter(
            (item) => Math.abs(item.getBoundingClientRect().top - rowTop) < 8,
          );
          const rowLeft = Math.min(
            ...rowItems.map((item) => item.getBoundingClientRect().left),
          );
          const rowRight = Math.max(
            ...rowItems.map((item) => item.getBoundingClientRect().right),
          );

          return Math.abs(rowLeft - bar.left - (bar.right - rowRight));
        }),
    )
    .toBeLessThan(24);

  const editor = page.getByLabel("Éditeur Markdown");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("- ");
  await expect(editor.locator("ul > li")).toHaveCount(1);
  await expect
    .poll(() =>
      editor
        .locator("ul")
        .evaluate((list) =>
          Number.parseFloat(getComputedStyle(list).paddingInlineStart),
        ),
    )
    .toBeGreaterThan(0);

  await page.keyboard.type("premier");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second");
  await expect(editor.locator("ul > li")).toHaveCount(2);

  await expect(editor).toContainText("premier");
  await expect(editor).toContainText("second");

  await page.keyboard.press("Control+A");
  await page.keyboard.type("# hello from playwright\n\nRendered body");
  await expect(
    editor.locator("h1", { hasText: "hello from playwright" }),
  ).toBeVisible({ timeout: 10_000 });

  const toolbar = page.getByRole("toolbar", {
    name: "Mise en forme Markdown",
  });
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("tableau");
  await toolbar.getByRole("button", { name: "Tableau" }).click();
  const table = editor.locator("table");
  await expect(table).toHaveCount(1);
  await expect(table.locator("tr")).toHaveCount(3);
  await expect(table.locator("th")).toHaveCount(3);

  await table.locator("td").first().hover();
  await page.getByLabel("Ajouter une ligne").click();
  await expect(table.locator("tr")).toHaveCount(4);

  await table.locator("td").first().hover();
  await page.getByLabel("Ajouter une colonne").click();
  await expect(table.locator("th")).toHaveCount(4);

  await table.locator("td").first().click({ button: "right" });
  const tableMenu = page.getByRole("menu", { name: "Actions du tableau" });
  await expect(tableMenu).toBeVisible();
  await expect(
    tableMenu.getByRole("menuitem", { name: "Insérer une ligne au-dessus" }),
  ).toBeVisible();
  await tableMenu
    .getByRole("menuitem", { name: "Supprimer la colonne" })
    .click();
  await expect(table.locator("th")).toHaveCount(3);

  await table.locator("td").first().click({ button: "right" });
  await tableMenu.getByRole("menuitem", { name: "Supprimer la ligne" }).click();
  await expect(table.locator("tr")).toHaveCount(3);

  await page.keyboard.press("Control+A");
  await page.keyboard.type(
    "![contenu prive](https://attacker.invalid/fuite.png)",
  );
  await expect(editor.locator('img[alt="contenu prive"]')).toHaveCount(1);
  await expect.poll(() => attemptedRemoteMedia).toBe(0);

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Recherche dans le coffre" });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Liens entrants" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Historique local" }),
  ).toBeVisible();

  await expect(page.locator('[data-status="synced"]')).toHaveText("synced", {
    timeout: 30_000,
  });
});
