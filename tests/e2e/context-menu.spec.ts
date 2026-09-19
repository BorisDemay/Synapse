import { expect, test } from "@playwright/test";
import {
  DEFAULT_PASSPHRASE,
  DEFAULT_PASSWORD,
  registerAndUnlock,
  uniqueEmail,
  writeAndSave,
} from "./fixtures";

test("context menu survives scrolling", async ({ page }) => {
  await registerAndUnlock(
    page,
    uniqueEmail("ctxmenu"),
    DEFAULT_PASSWORD,
    DEFAULT_PASSPHRASE,
    "create",
  );

  const paragraphs = Array.from(
    { length: 30 },
    (_, index) =>
      `Paragraphe ${index + 1} avec du texte suffisant pour remplir l'écran.`,
  ).join("\n\n");
  await writeAndSave(page, `# Menu contextuel\n\n${paragraphs}`);

  const editor = page.locator('.vditor-sv[contenteditable="true"]');
  await editor.click({ position: { x: 200, y: 120 } });

  // Open the context menu with a right click on the writing area.
  await editor.click({ button: "right", position: { x: 200, y: 120 } });
  const menu = page.getByRole("menu", { name: "Outils Markdown" });
  await expect(menu).toBeVisible();
  await page.screenshot({
    path: ".screens/context-menu-1-open.png",
    fullPage: false,
  });

  // Scroll the content underneath (pointer over the page, not the menu):
  // the menu must stay open.
  await page.mouse.move(950, 620);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  await expect(menu).toBeVisible();
  await page.screenshot({
    path: ".screens/context-menu-2-after-scroll.png",
    fullPage: false,
  });

  // Scrolling must remain the only non-dismissal: a click outside still closes.
  await page.mouse.click(40, 640);
  await expect(menu).toBeHidden();
  await page.screenshot({
    path: ".screens/context-menu-3-after-outside-click.png",
    fullPage: false,
  });
});
