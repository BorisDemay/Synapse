import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import {
  build,
  createServer,
  resolveConfig,
} from "../../apps/web/node_modules/vite/dist/node/index.js";

// Chokidar 4 no longer expands globs. The copy plugin must watch a literal
// directory while tinyglobby still collects all nested files for dev/build.
for (const app of ["web", "desktop"]) {
  test(`${app} serves, watches and copies local Vditor assets without glob watching`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "synapse-vditor-assets-"));
    const root = join(directory, "apps", app);
    const source = join(directory, "packages/ui/node_modules/vditor/dist");
    let server;
    try {
      await mkdir(root, { recursive: true });
      await mkdir(join(source, "js/lute"), { recursive: true });
      await writeFile(join(source, "index.css"), "/* synthetic asset */");
      await writeFile(
        join(source, "js/lute/lute.min.js"),
        "/* synthetic engine */",
      );
      await writeFile(join(root, "entry.js"), "export const fixture = true;");
      const config = await resolveConfig(
        { root, configFile: resolve(`apps/${app}/vite.config.ts`) },
        "serve",
      );
      const copyPlugins = config.plugins.filter((plugin) =>
        plugin.name.startsWith("vite-plugin-static-copy:"),
      );
      assert.equal(copyPlugins.length, 1);
      server = await createServer({
        root,
        configFile: false,
        plugins: copyPlugins,
        logLevel: "silent",
        server: { host: "127.0.0.1", port: 0, hmr: false },
      });
      await server.listen();
      const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
      const asset = async (path) => {
        const response = await fetch(`${origin}/vendor/vditor/dist/${path}`);
        assert.equal(response.status, 200);
        return response.text();
      };
      assert.equal(await asset("index.css"), "/* synthetic asset */");
      assert.equal(
        await asset("js/lute/lute.min.js"),
        "/* synthetic engine */",
      );
      await writeFile(join(source, "js/new.js"), "/* added asset */");
      const deadline = Date.now() + 5000;
      let added;
      while (Date.now() < deadline) {
        added = await fetch(`${origin}/vendor/vditor/dist/js/new.js`).then(
          (response) => response.text(),
        );
        if (added === "/* added asset */") break;
        await new Promise((done) => setTimeout(done, 100));
      }
      assert.equal(
        added,
        "/* added asset */",
        "New nested assets must be watched",
      );
      await server.close();
      server = undefined;

      const buildConfig = await resolveConfig(
        { root, configFile: resolve(`apps/${app}/vite.config.ts`) },
        "build",
      );
      await build({
        root,
        configFile: false,
        plugins: buildConfig.plugins.filter((plugin) =>
          plugin.name.startsWith("vite-plugin-static-copy:"),
        ),
        logLevel: "silent",
        build: { rollupOptions: { input: join(root, "entry.js") } },
      });
      for (const path of ["index.css", "js/lute/lute.min.js", "js/new.js"]) {
        assert.equal(
          await readFile(join(root, "dist/vendor/vditor/dist", path), "utf8"),
          await readFile(join(source, path), "utf8"),
        );
      }
    } finally {
      await server?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test(`${app} serves the dist URLs requested by the real Vditor loader`, async () => {
    const server = await createServer({
      root: resolve(`apps/${app}`),
      configFile: resolve(`apps/${app}/vite.config.ts`),
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
    });
    let browser;
    try {
      await server.listen();
      const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      // An isolated editor, not the app: no API, account or real vault data.
      // Load the UMD entry independently of the copy plugin so its actual CDN
      // requests, not a duplicated copy target, define the runtime contract.
      const entry = `/@fs/${resolve("packages/ui/node_modules/vditor/dist/index.min.js").replaceAll("\\", "/")}`;
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname !== "/__vditor-probe.html") return route.continue();
        return route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><meta charset="utf-8"><div id="editor"></div>
            <script src="${entry}"></script>
            <script>
              new Vditor("editor", {
                cdn: new URL("vendor/vditor", document.baseURI).href,
                cache: { enable: false },
                lang: "fr_FR", mode: "ir", toolbar: [],
                value: "Synthetic editor asset probe",
                after: () => { document.body.dataset.ready = "true"; }
              });
            </script>`,
        });
      });
      const assets = new Map();
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (url.pathname.startsWith("/vendor/vditor/")) {
          assets.set(url.pathname, response);
        }
      });
      await page.goto(`${origin}/__vditor-probe.html`);
      for (const path of ["js/i18n/fr_FR.js", "js/lute/lute.min.js"]) {
        const url = `/vendor/vditor/dist/${path}`;
        await expect.poll(() => assets.has(url)).toBe(true);
        const response = assets.get(url);
        assert.equal(response.status(), 200, `${url} must be served locally`);
        const expected = await readFile(
          resolve("packages/ui/node_modules/vditor/dist", path),
        );
        assert.ok(
          (await response.body()).equals(expected),
          `${url} must return the real asset, not an HTML fallback`,
        );
      }
      await expect(
        page.locator('.vditor-ir [contenteditable="true"]'),
      ).toBeEditable();
      await page.waitForFunction(() => document.body.dataset.ready === "true");
    } finally {
      await browser?.close();
      await server.close();
    }
  });
}
