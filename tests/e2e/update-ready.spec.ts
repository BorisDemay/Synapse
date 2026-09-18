import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";

const contentType: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// An already-open tab must surface a newly published web manifest without a
// reload. The provider re-checks on focus and online, which is what this test
// exercises against the real built application.
test("an already-open tab announces a newly published web update", async ({
  browser,
}) => {
  const root = resolve("apps/web/dist");
  let manifestVersion = "0.1.0";
  const requested: string[] = [];
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url!, "http://localhost").pathname;
    requested.push(pathname);
    if (pathname === "/updates/stable/web.json") {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          commit_sha: "b".repeat(40),
          notes: "Mise à jour de test",
          pub_date: "2026-09-12T12:00:00Z",
          version: manifestVersion,
        }),
      );
      return;
    }
    const file = resolve(
      root,
      pathname === "/" || !extname(pathname) ? "index.html" : pathname.slice(1),
    );
    if (!file.startsWith(`${root}/`)) {
      res.writeHead(400);
      res.end();
      return;
    }
    try {
      const bytes = await readFile(file);
      res.setHeader(
        "Content-Type",
        contentType[extname(file)] ?? "application/octet-stream",
      );
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const port = (server.address() as { port: number }).port;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const initialCheck = page.waitForResponse((response) =>
      response.url().endsWith("/updates/stable/web.json"),
    );
    await page.goto(`http://127.0.0.1:${port}/`);
    await initialCheck;
    await expect(page.locator(".synapse-update-banner")).toHaveCount(0);

    manifestVersion = "9.9.9";
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
    });

    const banner = page.locator(".synapse-update-banner");
    await expect(banner).toContainText("Mise à jour prête");
    await expect(banner).toContainText("9.9.9");
    expect(
      requested.filter((path) => path === "/updates/stable/web.json").length,
    ).toBeGreaterThanOrEqual(2);
  } finally {
    await context.close();
    await new Promise<void>((closed) => server.close(() => closed()));
  }
});
