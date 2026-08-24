import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const mainSource = readFileSync("src/main.ts", "utf8");

describe("desktop bootstrap", () => {
  it("uses the desktop shell and router so the instance URL can be configured", () => {
    expect(mainSource).toContain('import App from "./App.vue";');
    expect(mainSource).toContain('import { createAppRouter } from "./router";');
    expect(mainSource).not.toContain('from "../../web/src/router"');
  });
});
