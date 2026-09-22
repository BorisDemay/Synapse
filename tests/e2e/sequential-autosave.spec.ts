import { expect, test } from "@playwright/test";

import {
  DEFAULT_PASSPHRASE,
  DEFAULT_PASSWORD,
  expectSynced,
  registerAndUnlock,
  writeAndSave,
} from "./fixtures";

test("a draft started before an autosave acknowledgement follows its local revision", async ({
  page,
}) => {
  const email = `sequential-autosave-${Date.now()}@example.test`;
  await registerAndUnlock(
    page,
    email,
    DEFAULT_PASSWORD,
    DEFAULT_PASSPHRASE,
    "create",
  );
  await writeAndSave(page, "# sequential autosave\n\nseed");
  await expectSynced(page);

  let releaseAcknowledgement: (() => void) | undefined;
  const postedBases: number[] = [];
  const acknowledgementReleased = new Promise<void>((resolve) => {
    releaseAcknowledgement = resolve;
  });
  let firstAcknowledgement: { revision: number } | undefined;
  const firstAccepted = new Promise<void>((resolve) => {
    page.route("**/v1/vaults/*/operations", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      postedBases.push(
        (route.request().postDataJSON() as { base_revision: number })
          .base_revision,
      );
      if (firstAcknowledgement) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      firstAcknowledgement = (await response.json()) as { revision: number };
      resolve();
      await acknowledgementReleased;
      await route.fulfill({ response });
    });
  });

  await writeAndSave(page, "# sequential autosave\n\nfirst local edit");
  await firstAccepted;

  const editor = page.locator('.vditor-sv[contenteditable="true"]');
  await page.evaluate((value) => navigator.clipboard.writeText(value), "# sequential autosave\n\nsecond local edit");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+V");
  releaseAcknowledgement?.();

  await expect.poll(() => postedBases.length).toBe(2);
  await expectSynced(page);
  await expect(page.getByLabel("Éditeur Markdown")).toContainText(
    "second local edit",
  );

  expect(firstAcknowledgement).toBeDefined();
  expect(postedBases).toEqual([
    firstAcknowledgement!.revision - 1,
    firstAcknowledgement!.revision,
  ]);
});
