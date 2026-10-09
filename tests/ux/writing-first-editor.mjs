// Editor-lane real-browser regression for the writing-first UX pass.
// No backend: the Vite dev server is isolated, network calls are refused and
// no real account is used. Checks, against the real Vditor engine (IR and
// source modes):
//   1. Ctrl+K opens the global SearchPalette without mutating the note.
//   2. Ctrl+Shift+K inserts a link through the engine hotkey.
//   3. The public MarkdownEditor focus() puts the caret in the writing area.
import { createServer } from "../../apps/web/node_modules/vite/dist/node/index.js";
import { chromium } from "@playwright/test";
import { resolve } from "node:path";

const server = await createServer({
  root: resolve("apps/web"),
  configFile: resolve("apps/web/vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port: 16175,
    strictPort: true,
    hmr: false,
    watch: null,
  },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route("**/v1/**", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.goto("http://127.0.0.1:16175/login");
  // Let the app's initial session restore (401 offline) settle first so it
  // cannot clobber the local-mode identity set below.
  await page.waitForLoadState("networkidle");

  await page.evaluate(async () => {
    const { useVaultStore } = await import("/src/stores/vault.ts");
    const { useAuthStore } = await import("/src/stores/auth.ts");
    const { wrapVaultKey, encodeWrappedVaultKey } = await import(
      "/src/crypto/vault-key.ts"
    );
    const { putCachedEnvelope } = await import("/src/offline/cache.ts");
    const auth = useAuthStore();
    try {
      await auth.restoreSession();
    } catch {
      // Offline on purpose.
    }
    await auth.enterLocalMode();
    const vault = useVaultStore();
    const vaultId = "0198e5de-1111-7222-8333-444455556666";
    const key = crypto.getRandomValues(new Uint8Array(32));
    await putCachedEnvelope(
      auth.userId,
      vaultId,
      encodeWrappedVaultKey(await wrapVaultKey(key, "synthetic ux passphrase")),
    );
    vault.unlock(key, vaultId, 0);
    key.fill(0);
    const noteId = "0198e5de-7777-7888-8999-000000000099";
    await vault.saveNote({
      id: noteId,
      content: "# Note ux\n\nContenu initial de la note.\n",
    });
    window.__ux = { vault, noteId };
    await document
      .querySelector("#app")
      .__vue_app__.config.globalProperties.$router.push("/vault");
  });

  await page.getByRole("treeitem").first().click();
  const editor = page.getByRole("textbox", {
    name: "Éditeur Markdown",
    exact: true,
  });
  await editor.waitFor({ state: "visible" });

  const palette = page.locator(
    '[role="dialog"][aria-label="Recherche dans le coffre"]',
  );

  const noteContent = () =>
    page.evaluate(
      () => window.__ux.vault.notes.get(window.__ux.noteId).content,
    );

  async function waitForContent(predicate, label) {
    const deadline = Date.now() + 8000;
    let last;
    while (Date.now() < deadline) {
      last = await noteContent();
      if (predicate(last)) {
        return last;
      }
      await page.waitForTimeout(100);
    }
    throw new Error(`Note content never satisfied: ${label}\n${last}`);
  }

  const linkCount = (value) => value.split("](https://)").length - 1;

  // The dialogs lane owns the palette's Shift guard; until it lands, the
  // palette may also open on Ctrl+Shift+K. Dismiss it without judging.
  async function dismissPaletteIfOpen() {
    if (await palette.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      await palette.waitFor({ state: "hidden" });
    }
  }

  // 1. Ctrl+K opens the palette without mutating the note (IR mode).
  await editor.click();
  const initial = await noteContent();
  await page.keyboard.press("Control+k");
  await palette.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "hidden" });
  await page.waitForTimeout(900); // editor save debounce + durable save
  const afterCtrlK = await noteContent();
  if (afterCtrlK !== initial) {
    throw new Error(
      `Ctrl+K mutated the note (global palette regression):\n${afterCtrlK}`,
    );
  }

  // 2. Ctrl+Shift+K inserts a link in IR mode.
  await editor.click();
  await page.keyboard.press("Control+Shift+k");
  await waitForContent(
    (value) => linkCount(value) === 1,
    "link inserted via Ctrl+Shift+K in IR mode",
  );
  await dismissPaletteIfOpen();

  // 3. Same contract in source mode.
  await page.getByLabel("Mode d'édition").getByText("Texte brut").click();
  await editor.waitFor({ state: "visible" });
  await editor.click();
  await page.keyboard.press("Control+k");
  await palette.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "hidden" });
  await page.waitForTimeout(900);
  let value = await noteContent();
  if (linkCount(value) !== 1) {
    throw new Error(`Ctrl+K mutated the note in source mode:\n${value}`);
  }
  await editor.click();
  await page.keyboard.press("Control+Shift+k");
  await waitForContent(
    (value2) => linkCount(value2) === 2,
    "link inserted via Ctrl+Shift+K in source mode",
  );
  await dismissPaletteIfOpen();

  // 4. Public focus() targets the writing area.
  await page.evaluate(() => {
    const host = document.querySelector(".markdown-editor");
    host.__vueParentComponent?.exposed?.focus();
  });
  const focused = await page.evaluate(() => ({
    aria: document.activeElement?.getAttribute("aria-label"),
    inWritingArea: Boolean(
      document.activeElement?.closest(".vditor-ir, .vditor-sv"),
    ),
  }));
  if (focused.aria !== "Éditeur Markdown" || !focused.inWritingArea) {
    throw new Error(
      `focus() did not reach the writing area: ${JSON.stringify(focused)}`,
    );
  }

  console.log(
    JSON.stringify({
      ctrl_k_palette_without_mutation: true,
      ctrl_shift_k_link_ir: true,
      ctrl_shift_k_link_source: true,
      editor_focus: true,
    }),
  );
} finally {
  await browser?.close();
  await server.close();
}
