import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
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
      await mkdir(join(source, "js"), { recursive: true });
      await writeFile(join(source, "index.css"), "/* synthetic asset */");
      await writeFile(join(source, "js/lute.min.js"), "/* synthetic engine */");
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
      assert.equal(await asset("js/lute.min.js"), "/* synthetic engine */");
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
      for (const path of ["index.css", "js/lute.min.js", "js/new.js"]) {
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
}
