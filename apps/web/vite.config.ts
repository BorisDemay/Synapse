import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

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
      "/auth": "http://127.0.0.1:3000",
      "/v1": "http://127.0.0.1:3000",
      "/vaults": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000",
    },
  },
  test: {
    environment: "jsdom",
  },
});
