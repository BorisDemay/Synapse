import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const apiProxy = process.env.SYNAPSE_API_PROXY ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        {
          src: "../../packages/ui/node_modules/vditor/dist/**/*",
          dest: "vendor/vditor",
          rename: { stripBase: 4 },
        },
      ],
    }),
    {
      name: "synapse-offline-manifest",
      apply: "build",
      async closeBundle() {
        const directory = fileURLToPath(new URL("./dist", import.meta.url));
        async function files(path: string): Promise<string[]> {
          const entries = await readdir(path, { withFileTypes: true });
          return (
            await Promise.all(
              entries.map((entry) =>
                entry.isDirectory()
                  ? files(join(path, entry.name))
                  : Promise.resolve([join(path, entry.name)]),
              ),
            )
          ).flat();
        }
        const assets = (await files(directory))
          .map((path) => `/${relative(directory, path).split("\\").join("/")}`)
          .filter(
            (path) =>
              path !== "/sw.js" &&
              path !== "/precache-manifest.json" &&
              // TypeScript typings shipped with Vditor are never used at
              // runtime and only slow down the offline precache.
              !path.endsWith(".d.ts") &&
              !path.endsWith(".map"),
          )
          .sort();
        await writeFile(
          join(directory, "precache-manifest.json"),
          JSON.stringify(assets),
        );
        const hash = createHash("sha256");
        for (const path of assets) {
          hash.update(path);
          hash.update(await readFile(join(directory, path.slice(1))));
        }
        const workerPath = join(directory, "sw.js");
        const worker = await readFile(workerPath, "utf8");
        await writeFile(
          workerPath,
          worker.replaceAll("__SYNAPSE_PRECACHE_HASH__", hash.digest("hex")),
        );
      },
    },
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        sw: fileURLToPath(new URL("./src/sw.ts", import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
      },
    },
  },
  server: {
    host: "localhost",
    port: 5173,
    proxy: {
      "/auth": apiProxy,
      "/v1": { target: apiProxy, ws: true },
      "/vaults": apiProxy,
      "/health": apiProxy,
    },
  },
  test: {
    environment: "jsdom",
  },
});
