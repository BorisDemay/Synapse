import { expect, test } from "@playwright/test";
import {
  DEFAULT_PASSPHRASE,
  DEFAULT_PASSWORD,
  expectSynced,
  registerAndUnlock,
  uniqueEmail,
  writeAndSave,
} from "./fixtures";
import { persistedMarkdown } from "./durable-cache";

test("a draft started before its preceding autosave is acknowledged does not conflict with that autosave", async ({
  page,
}) => {
  await registerAndUnlock(
    page,
    uniqueEmail("sequential"),
    DEFAULT_PASSWORD,
    DEFAULT_PASSPHRASE,
    "create",
  );
  await writeAndSave(page, "# Sequential fixture\n\nInitial version.");
  await expectSynced(page);

  let releaseAck!: () => void;
  const ackGate = new Promise<void>((resolve) => {
    releaseAck = resolve;
  });
  let held = false;
  let waiting = false;
  let acceptedRevision = 0;
  const sentBases: number[] = [];
  await page.route("**/v1/vaults/*/operations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sentBases.push(route.request().postDataJSON().base_revision);
    if (held) return route.continue();
    held = true;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    acceptedRevision = (await response.json()).revision;
    waiting = true;
    await ackGate;
    await route.fulfill({ response });
  });

  try {
    await writeAndSave(page, "# Sequential fixture\n\nFirst autosave.");
    await expect.poll(() => waiting).toBe(true);
    // Freeze only page timers: the next editor draft must start before the ACK,
    // but its debounce must not enqueue it until after that ACK was processed.
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    const latest =
      "# Sequential fixture\n\nSecond autosave, continuing the first.";
    await page.evaluate(
      (value) => navigator.clipboard.writeText(value),
      latest,
    );
    await page.locator('.vditor-sv[contenteditable="true"]').click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Control+V");
    await page.clock.runFor(50);
    releaseAck();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const app = (document.querySelector("#app") as any).__vue_app__;
          return app.config.globalProperties.$pinia._s.get("vault")
            .headRevision;
        }),
      )
      .toBe(acceptedRevision);
    await page.clock.runFor(1000);
    await expect
      .poll(() => persistedMarkdown(page, DEFAULT_PASSPHRASE))
      .toContain(latest);
    await expectSynced(page);
    await expect(
      page.getByRole("region", { name: "Résolution de conflit" }),
    ).toHaveCount(0);
    expect(sentBases).toEqual([acceptedRevision - 1, acceptedRevision]);
  } finally {
    releaseAck();
  }
});
