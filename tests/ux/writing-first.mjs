import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "../../apps/web/node_modules/vite/dist/node/index.js";

// Only synthetic fixtures in a disposable browser profile; no real API or account.
let server;
let browser;
let origin;
before(async () => {
  server = await createServer({
    root: resolve("apps/web"),
    configFile: resolve("apps/web/vite.config.ts"),
    server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function fixture(
  viewport = { width: 1440, height: 900 },
  colorScheme = "light",
) {
  const context = await browser.newContext({ viewport, colorScheme });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (/^\/(auth|v1|vaults|health)\//u.test(url.pathname)) {
      return route.fulfill({ status: 401, json: {} });
    }
    return route.continue();
  });
  await page.goto(`${origin}/login`);
  await page.getByRole("heading", { name: "Bon retour." }).waitFor();
  await page.evaluate(async () => {
    const { useAuthStore } = await import("/src/stores/auth.ts");
    const { useVaultStore } = await import("/src/stores/vault.ts");
    const { uuidV7 } = await import("/src/crypto/vault-key.ts");
    await useAuthStore().enterLocalMode();
    const vault = useVaultStore();
    await vault.createAndUnlockVault("synthetic UX regression passphrase");
    for (const [path, content] of [
      ["Projects/Website.md", "# Website\n\nA synthetic writing fixture."],
      ["Work/Overview.md", "# Overview\n\nWork fixture."],
      ["Personal/Overview.md", "# Overview\n\nPersonal fixture."],
      ["Templates/Daily.md", "# {{title}}\n\nDaily fixture."],
    ]) {
      const id = uuidV7();
      await vault.saveNote({ id, path, content });
      if (path === "Projects/Website.md") await vault.rememberRecentNote(id);
    }
    await document
      .querySelector("#app")
      .__vue_app__.config.globalProperties.$router.push("/vault");
  });
  await page
    .getByRole("textbox", { name: "Éditeur Markdown", exact: true })
    .waitFor();
  return { page, close: () => context.close() };
}

async function openNote(page, title) {
  await page.keyboard.press("Control+k");
  await page
    .getByRole("searchbox", { name: "Rechercher une note ou une commande" })
    .fill(title);
  await page.getByRole("option").filter({ hasText: title }).first().click();
}

for (const mode of ["Markdown", "Texte brut"]) {
  test(`global search never changes a ${mode} document`, async () => {
    const { page, close } = await fixture();
    try {
      await openNote(page, "Website");
      await page.getByRole("button", { name: mode, exact: true }).click();
      const editor = page.getByRole("textbox", {
        name: "Éditeur Markdown",
        exact: true,
      });
      await editor.click({ position: { x: 50, y: 30 } });
      await page.keyboard.press("Control+Home");
      const before = await editor.innerText();
      await page.keyboard.press("Control+k");
      await expect(
        page.getByRole("dialog", { name: "Recherche dans le coffre" }),
      ).toBeVisible();
      assert.equal(
        await editor.innerText(),
        before,
        "Search must not insert link syntax",
      );
    } finally {
      await close();
    }
  });
}

test("duplicate filenames retain full folder context in search", async () => {
  const { page, close } = await fixture();
  try {
    await page.keyboard.press("Control+k");
    await page.getByRole("searchbox").fill("Overview");
    const results = page.getByRole("listbox", {
      name: "Résultats de recherche",
    });
    await expect(results).toContainText("Work/Overview.md");
    await expect(results).toContainText("Personal/Overview.md");
  } finally {
    await close();
  }
});

test("new note is ready for typing and settings is a keyboard modal", async () => {
  const { page, close } = await fixture();
  try {
    await page
      .getByRole("button", { name: "Nouvelle note", exact: true })
      .first()
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.isContentEditable === true),
      )
      .toBe(true);
    const trigger = page.getByRole("button", { name: "Ouvrir les paramètres" });
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "Paramètres",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.activeElement
            ?.closest('[role="dialog"]')
            ?.getAttribute("aria-label"),
        ),
      )
      .toBe("Paramètres");
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(
          () => !!document.activeElement?.closest('[role="dialog"]'),
        ),
        true,
      );
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  } finally {
    await close();
  }
});

test("returning to the vault resumes the recent note and reports local-only saving honestly", async () => {
  const { page, close } = await fixture();
  try {
    await expect(
      page.getByRole("textbox", { name: "Éditeur Markdown", exact: true }),
    ).toContainText("Website");
    await expect(page.locator(".sync-pill")).not.toContainText(
      /synced|synchronisé/iu,
    );
    await expect(page.locator(".sync-pill")).toContainText(/local|appareil/iu);
  } finally {
    await close();
  }
});

test("writing surface is spacious and seamless on desktop without mobile overflow", async () => {
  const { page, close } = await fixture({ width: 1440, height: 900 }, "dark");
  try {
    for (const mode of ["Markdown", "Texte brut"]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      await page
        .getByRole("textbox", { name: "Éditeur Markdown", exact: true })
        .focus();
      const writingSelector =
        mode === "Markdown" ? ".vditor-ir > .vditor-reset" : ".vditor-sv";
      const canvasSelector =
        mode === "Markdown" ? ".vditor-ir" : ".vditor-content";
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const layout = await page.evaluate(
          ({ writingSelector, canvasSelector }) => {
            const pane = document.querySelector(".editor-surface");
            const writing = document.querySelector(writingSelector);
            const canvas = document.querySelector(canvasSelector);
            return {
              paneWidth: pane.getBoundingClientRect().width,
              writingWidth: writing.getBoundingClientRect().width,
              writingBackground: getComputedStyle(writing).backgroundColor,
              canvasBackground: getComputedStyle(canvas).backgroundColor,
              viewportOverflow:
                document.documentElement.scrollWidth > innerWidth,
            };
          },
          { writingSelector, canvasSelector },
        );
        if (width === 1440) {
          assert.ok(
            layout.writingWidth >= 850,
            `${mode} note is too narrow: ${JSON.stringify(layout)}`,
          );
          assert.equal(
            layout.writingBackground,
            layout.canvasBackground,
            `${mode} column must blend with its canvas`,
          );
        } else {
          assert.ok(
            layout.writingWidth <= layout.paneWidth,
            `${mode} mobile note overflows: ${JSON.stringify(layout)}`,
          );
          assert.equal(
            layout.viewportOverflow,
            false,
            `${mode} mobile viewport overflows: ${JSON.stringify(layout)}`,
          );
        }
      }
    }
  } finally {
    await close();
  }
});

test("deleted notes recover the latest draft and path after reopening", async () => {
  const { page, close } = await fixture();
  try {
    await openNote(page, "Website");
    await page.getByRole("button", { name: "Texte brut", exact: true }).click();
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() =>
      navigator.clipboard.writeText(
        "# Website\n\nLatest draft before deletion.",
      ),
    );
    await page
      .getByRole("textbox", { name: "Éditeur Markdown", exact: true })
      .click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+v");
    const remove = page.getByRole("button", {
      name: "Supprimer Website",
      exact: true,
    });
    if (!(await remove.isVisible()))
      await page
        .getByRole("treeitem", { name: "Projects", exact: true })
        .click();
    await remove.click();
    await expect(
      page.getByRole("button", { name: "Annuler la suppression", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page
      .getByLabel("Phrase de déchiffrement", { exact: true })
      .fill("synthetic UX regression passphrase");
    await page
      .getByRole("button", { name: "Déverrouiller", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Éléments supprimés", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Éléments supprimés",
      exact: true,
    });
    await expect(dialog).toContainText("Projects/Website.md");
    await dialog
      .getByRole("button", { name: "Restaurer Website", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Fermer les éléments supprimés" })
      .click();
    await openNote(page, "Website");
    await expect(
      page.getByRole("textbox", { name: "Éditeur Markdown", exact: true }),
    ).toContainText("Latest draft before deletion.");
  } finally {
    await close();
  }
});

test("mobile navigation fills the screen and New note returns focus to the editor", async () => {
  const { page, close } = await fixture({ width: 390, height: 844 });
  try {
    await page
      .getByRole("button", { name: "Ouvrir la navigation", exact: true })
      .click();
    const drawer = page.locator("#app-shell-sidebar");
    assert.ok(
      (await drawer.boundingBox()).height >= 840,
      "Drawer must not retain the old stacked-sidebar height cap",
    );
    await drawer
      .getByRole("button", { name: "Nouvelle note", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Ouvrir la navigation", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.isContentEditable === true),
      )
      .toBe(true);
    const stroke = await page
      .locator('.vditor-toolbar button[data-type="headings"] svg')
      .evaluate((el) => parseFloat(getComputedStyle(el).strokeWidth));
    assert.ok(
      stroke > 0,
      "Icon-only toolbar needs visible strokes, not Vditor's fill-only defaults",
    );
  } finally {
    await close();
  }
});

test("mobile side tools own focus and Escape returns to writing", async () => {
  const { page, close } = await fixture({ width: 390, height: 844 });
  try {
    const trigger = page.getByRole("button", {
      name: "Assistant",
      exact: true,
    });
    await trigger.click();
    await expect
      .poll(() =>
        page.evaluate(
          () => !!document.activeElement?.closest("#app-shell-assistant"),
        ),
      )
      .toBe(true);
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(
          () => !!document.activeElement?.closest("#app-shell-assistant"),
        ),
        true,
      );
    }
    await page.keyboard.press("Escape");
    await expect(page.locator("#app-shell-assistant")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {
    await close();
  }
});

for (const width of [1440, 1280, 1024, 768, 390]) {
  test(`writing and assistant remain reachable at ${width}px`, async () => {
    const { page, close } = await fixture({ width, height: 844 });
    try {
      const editor = page.getByRole("textbox", {
        name: "Éditeur Markdown",
        exact: true,
      });
      if (width === 390) {
        assert.ok(
          (await editor.boundingBox()).y < 300,
          "Navigation/formatting must not bury the note",
        );
      }
      await page
        .getByRole("button", { name: "Assistant", exact: true })
        .click();
      const panel = page.locator("#app-shell-assistant");
      await expect(panel).toBeVisible();
      const rect = await panel.boundingBox();
      assert.ok(
        rect.x >= 0 && rect.x + rect.width <= width + 1,
        "Assistant must fit the viewport",
      );
      await expect(
        page.getByRole("button", { name: "Fermer l’assistant", exact: true }),
      ).toBeInViewport();
      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      assert.equal(hasHorizontalOverflow, false);
    } finally {
      await close();
    }
  });
}
