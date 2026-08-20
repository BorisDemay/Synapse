import vue from "@vitejs/plugin-vue";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { defineConfig } from "vitest/config";

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
  test: {
    environment: "jsdom",
  },
});
