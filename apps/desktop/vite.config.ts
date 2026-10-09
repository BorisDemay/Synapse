import vue from "@vitejs/plugin-vue";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        {
          // Chokidar 4 watches directories, not glob patterns.
          src: "../../packages/ui/node_modules/vditor/dist",
          dest: "vendor/vditor",
          // Keep dist/: Vditor appends /dist/js/... to its CDN base URL.
          rename: { stripBase: 4 },
        },
      ],
    }),
  ],
  test: {
    environment: "jsdom",
  },
});
