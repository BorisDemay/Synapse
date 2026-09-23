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

async function selectEditorText(editor, text) {
  return editor.evaluate((editable, needle) => {
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.textContent?.indexOf(needle) ?? -1;
      if (start < 0) continue;
      editable.focus();
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + needle.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const box = range.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    throw new Error("Synthetic fixture text not found");
  }, text);
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

test("collapsed sidebar keeps only accessible icons inside its mini-rail", async () => {
  const { page, close } = await fixture();
  try {
    await page.evaluate(async () => {
      const { useAuthStore } = await import("/src/stores/auth.ts");
      useAuthStore().storageHealth = {
        availableBytes: 1024 * 1024 * 1024,
        lastSuccessfulBackup: null,
        pendingOperationCount: 0,
        persistent: false,
        quotaBytes: null,
        serverPendingOperationCount: null,
        serverUsedBytes: null,
        usageBytes: null,
      };
    });
    const sidebar = page.locator("#app-shell-sidebar");
    await expect(sidebar.locator(".storage-health")).toBeVisible();
    await page
      .getByRole("button", { name: "Masquer la barre latérale" })
      .click();
    await expect(sidebar).toHaveCSS("width", "48px");
    await expect(sidebar.locator(".storage-health")).toBeHidden();
    for (const label of [
      "Rechercher dans les notes",
      "Éléments supprimés",
      "Ouvrir les paramètres",
      "Se déconnecter",
    ]) {
      const button = sidebar.getByRole("button", { name: label });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      assert.ok(
        box &&
          box.x >= 0 &&
          box.x + box.width <= 48 &&
          box.y >= 0 &&
          box.y + box.height <= 900,
        `${label} must fit in the rail and viewport`,
      );
    }
    await sidebar
      .getByRole("button", { name: "Afficher la barre latérale" })
      .click();
    await expect(sidebar.locator(".storage-health")).toBeVisible();
  } finally {
    await close();
  }
});

test("notifications share a top-right stack with distinct type colors", async () => {
  const { page, close } = await fixture({ width: 390, height: 844 });
  try {
    await page.evaluate(async () => {
      const { notify } = await import("/src/notifications/toasts.ts");
      for (const kind of ["info", "success", "warning", "error"])
        notify({ kind, message: `Synthetic ${kind}` });
    });
    const colors = await page
      .locator(".toast-stack .toast")
      .evaluateAll((items) =>
        items.map((item) => ({
          color: getComputedStyle(item).borderInlineStartColor,
          kind: item.dataset.kind,
          right: item.getBoundingClientRect().right,
          top: item.getBoundingClientRect().top,
        })),
      );
    assert.deepEqual(
      colors.map((item) => item.kind),
      ["info", "success", "warning", "error"],
    );
    assert.equal(new Set(colors.map((item) => item.color)).size, 4);
    assert.ok(colors.every((item) => item.right <= 390 && item.top < 400));
    await page
      .getByRole("button", { name: "Fermer la notification" })
      .first()
      .click();
    await expect(page.locator(".toast-stack .toast")).toHaveCount(3);
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
    const undoToast = page.locator('.toast-stack [data-kind="success"]');
    await expect(undoToast).toContainText("Website supprimé.");
    await expect(
      undoToast.getByRole("button", {
        name: "Annuler la suppression",
        exact: true,
      }),
    ).toBeVisible();
    const toastBox = await undoToast.boundingBox();
    assert.ok(
      toastBox && toastBox.x > 0 && toastBox.y < 120,
      "Deletion notification must appear at the top right, not in the editor",
    );
    await expect(page.locator(".deletion-notice")).toHaveCount(0);
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

for (const mode of ["Markdown", "Texte brut"]) {
  test(`right-click Copy, Cut and Paste work in ${mode} mode`, async () => {
    const { page, close } = await fixture();
    try {
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"]);
      await openNote(page, "Website");
      await page.getByRole("button", { name: mode, exact: true }).click();
      const editor = page.getByRole("textbox", {
        name: "Éditeur Markdown",
        exact: true,
      });
      const rect = await selectEditorText(editor, "synthetic writing");
      await page.mouse.click(rect.x, rect.y, { button: "right" });
      const menu = page.getByRole("menu", { name: "Outils Markdown" });
      await expect(menu).toBeVisible();
      const copy = menu.getByRole("menuitem", { name: "Copier" });
      await expect(copy).not.toHaveAttribute("aria-disabled", "true");
      await copy.click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe("synthetic writing");

      const cutRect = await selectEditorText(editor, "synthetic writing");
      await page.mouse.click(cutRect.x, cutRect.y, { button: "right" });
      await page
        .getByRole("menu", { name: "Outils Markdown" })
        .getByRole("menuitem", { name: "Couper" })
        .click();
      await expect(editor).not.toContainText("synthetic writing");
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe("synthetic writing");

      const caret = await editor.evaluate((editable) => {
        const walker = document.createTreeWalker(
          editable,
          NodeFilter.SHOW_TEXT,
        );
        let node;
        while ((node = walker.nextNode())) {
          if (!node.textContent?.includes("fixture")) continue;
          const range = document.createRange();
          range.setStart(node, node.textContent.length);
          range.collapse(true);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          const box = node.parentElement.getBoundingClientRect();
          return { x: box.right - 4, y: box.top + box.height / 2 };
        }
        throw new Error("Synthetic fixture text not found");
      });
      await page.mouse.click(caret.x, caret.y, { button: "right" });
      await page
        .getByRole("menu", { name: "Outils Markdown" })
        .getByRole("menuitem", { name: "Coller", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await editor.innerText()).match(/synthetic writing/gu)?.length ??
            0,
        )
        .toBe(1);
    } finally {
      await close();
    }
  });
}

test("the formatting toolbar is hidden while right-click commands still edit", async () => {
  const { page, close } = await fixture();
  try {
    await expect(page.locator(".vditor-toolbar")).toBeHidden();
    await openNote(page, "Website");
    await page.getByRole("button", { name: "Texte brut", exact: true }).click();
    const editor = page.getByRole("textbox", {
      name: "Éditeur Markdown",
      exact: true,
    });
    const rect = await selectEditorText(editor, "synthetic writing");
    await page.mouse.click(rect.x, rect.y, { button: "right" });
    await page
      .getByRole("menu", { name: "Outils Markdown" })
      .getByRole("menuitem", { name: "Formater" })
      .hover();
    await page
      .getByRole("menu", { name: "Formater" })
      .getByRole("menuitem", { name: "Gras" })
      .click();
    await expect(editor).toContainText("**synthetic writing**");
  } finally {
    await close();
  }
});

test("right-click exposes emoji, formatting, history and editor modes", async () => {
  const { page, close } = await fixture({ width: 1280, height: 720 });
  try {
    await openNote(page, "Website");
    let editor = page.getByRole("textbox", {
      name: "Éditeur Markdown",
      exact: true,
    });
    await editor.click({ button: "right", position: { x: 60, y: 40 } });
    let menu = page.getByRole("menu", { name: "Outils Markdown" });
    for (const label of [
      "Annuler",
      "Rétablir",
      "Formater",
      "Paragraphe",
      "Insérer",
      "Émojis",
      "Mode d’édition",
      "Couper",
      "Copier",
      "Coller",
    ]) {
      await expect(
        menu.getByRole("menuitem", { name: label, exact: true }),
      ).toBeVisible();
    }
    await menu.getByRole("menuitem", { name: "Émojis" }).hover();
    await page
      .getByRole("menu", { name: "Émojis" })
      .getByRole("menuitem", { name: "😄 Sourire" })
      .click();
    await expect(editor).toContainText("😄");

    await editor.click({ button: "right", position: { x: 60, y: 40 } });
    menu = page.getByRole("menu", { name: "Outils Markdown" });
    await menu.getByRole("menuitem", { name: "Mode d’édition" }).hover();
    await page
      .getByRole("menu", { name: "Mode d’édition" })
      .getByRole("menuitem", { name: "Texte brut" })
      .click();
    editor = page.getByRole("textbox", {
      name: "Éditeur Markdown",
      exact: true,
    });
    await expect(editor).toHaveClass(/vditor-sv/u);
  } finally {
    await close();
  }
});

test("mobile right-click keeps the last command and submenus clickable", async () => {
  const { page, close } = await fixture({ width: 390, height: 700 });
  try {
    await openNote(page, "Website");
    const editor = page.getByRole("textbox", { name: "Éditeur Markdown", exact: true });
    await editor.click({ button: "right", position: { x: 180, y: 45 } });
    const menu = page.getByRole("menu", { name: "Outils Markdown" });
    await expect(menu).toBeVisible();
    const last = menu.getByRole("menuitem", { name: "Tout sélectionner" });
    await last.scrollIntoViewIfNeeded();
    assert.equal(
      await last.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const target = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return target === button || button.contains(target);
      }),
      true,
    );
    await menu.getByRole("menuitem", { name: "Émojis" }).hover();
    const submenu = page.getByRole("menu", { name: "Émojis" });
    await expect(submenu.getByRole("menuitem", { name: "😄 Sourire" })).toBeInViewport();
  } finally {
    await close();
  }
});

test("denied clipboard reads do not change a note silently", async () => {
  const { page, close } = await fixture();
  try {
    await openNote(page, "Website");
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "readText", {
        configurable: true,
        value: async () => {
          throw new DOMException("denied", "NotAllowedError");
        },
      });
    });
    const editor = page.getByRole("textbox", {
      name: "Éditeur Markdown",
      exact: true,
    });
    const before = await editor.innerText();
    await editor.click({ button: "right", position: { x: 45, y: 35 } });
    await page
      .getByRole("menu", { name: "Outils Markdown" })
      .getByRole("menuitem", { name: "Coller", exact: true })
      .click();
    await expect(
      page.locator(".markdown-editor-clipboard-status"),
    ).toContainText("utilisez Ctrl+V");
    assert.equal(await editor.innerText(), before);
  } finally {
    await close();
  }
});

test("desktop sidebar footer keeps account actions readable on one line", async () => {
  const { page, close } = await fixture({ width: 1280, height: 720 });
  try {
    const footer = page.locator(".app-shell-sidebar .sidebar-footer");
    const settings = footer.getByRole("button", {
      name: "Ouvrir les paramètres",
    });
    const logout = footer.getByRole("button", { name: "Se déconnecter" });
    const lines = await logout.locator(".logout-label").evaluate((label) => {
      const range = document.createRange();
      range.selectNodeContents(label);
      return range.getClientRects().length;
    });
    assert.equal(lines, 1, "Logout label must not wrap in a wide viewport");
    const settingsBox = await settings.boundingBox();
    const logoutBox = await logout.boundingBox();
    assert.ok(logoutBox.y >= settingsBox.y + settingsBox.height - 1);
  } finally {
    await close();
  }
});

test("vault action tooltips stay within both viewport edges", async () => {
  const { page, close } = await fixture({ width: 1280, height: 720 });
  try {
    const action = page.getByRole("button", {
      name: "Créer depuis un modèle",
      exact: true,
    });
    const tooltip = page.locator("#synapse-tooltip");
    await action.hover();
    await expect(tooltip).toBeVisible();
    let rect = await tooltip.boundingBox();
    assert.ok(rect.x >= 8, "The left-edge tooltip must stay on screen");

    await page.mouse.move(700, 600);
    await expect(tooltip).toBeHidden();
    await action.evaluate((button) => {
      button.style.position = "fixed";
      button.style.top = "80px";
      button.style.right = "8px";
      button.style.zIndex = "9999";
    });
    await action.hover();
    await expect(tooltip).toBeVisible();
    rect = await tooltip.boundingBox();
    assert.ok(
      rect.x + rect.width <= 1280 - 8,
      "The right-edge tooltip must stay on screen",
    );
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
    await expect(
      drawer.getByRole("button", { name: "Se déconnecter", exact: true }),
    ).toBeInViewport();
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
    await page.keyboard.press("Shift+F10");
    await expect(
      page.getByRole("menu", { name: "Outils Markdown" }),
    ).toBeVisible();
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
