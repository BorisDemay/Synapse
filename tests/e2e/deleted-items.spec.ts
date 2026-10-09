import { expect, test } from "@playwright/test";
import {
  DEFAULT_PASSWORD,
  DEFAULT_PASSPHRASE,
  expectSynced,
  registerAndUnlock,
  uniqueEmail,
  writeAndSave,
} from "./fixtures";

test("a deleted note restores from encrypted local history after reopening and syncs as a new revision", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("deleted-recovery");
  await registerAndUnlock(
    page,
    email,
    DEFAULT_PASSWORD,
    DEFAULT_PASSPHRASE,
    "create",
  );
  await writeAndSave(page, "# Recoverable note\n\nBefore accidental deletion.");
  await expectSynced(page);
  await page
    .getByRole("button", { name: "Supprimer Recoverable note", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Annuler la suppression", exact: true }),
  ).toBeVisible();
  await expectSynced(page);

  await page.reload();
  await registerAndUnlock(
    page,
    email,
    DEFAULT_PASSWORD,
    DEFAULT_PASSPHRASE,
    "unlock",
  );
  await page
    .getByRole("button", { name: "Éléments supprimés", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Éléments supprimés",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Restaurer Recoverable note", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Restaurer Recoverable note",
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Fermer les éléments supprimés" })
    .click();
  await expectSynced(page);

  const second = await browser.newContext();
  try {
    const other = await second.newPage();
    await registerAndUnlock(
      other,
      email,
      DEFAULT_PASSWORD,
      DEFAULT_PASSPHRASE,
      "unlock",
    );
    await other.keyboard.press("Control+k");
    await other
      .getByRole("searchbox", { name: "Rechercher une note ou une commande" })
      .fill("Recoverable note");
    await other
      .getByRole("option")
      .filter({ hasText: "Recoverable note" })
      .click();
    await expect(
      other.getByRole("textbox", { name: "Éditeur Markdown", exact: true }),
    ).toContainText("Before accidental deletion.");
  } finally {
    await second.close();
  }
});
