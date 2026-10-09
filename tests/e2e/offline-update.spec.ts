import { expect, test } from "@playwright/test";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";

test("an old tab retains offline assets across an explicitly activated web update", async ({
  browser,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "synapse-two-builds-"));
  const one = join(directory, "one"),
    two = join(directory, "two");
  await cp("apps/web/dist", one, { recursive: true });
  await cp("apps/web/dist", two, { recursive: true });
  for (const [path, version] of [
    [one, "one"],
    [two, "two"],
  ]) {
    const module = `/assets/lazy-${version}.js`;
    await writeFile(
      join(path!, module.slice(1)),
      `export const value=${JSON.stringify(version)};`,
    );
    const manifest = JSON.parse(
      await readFile(join(path!, "precache-manifest.json"), "utf8"),
    );
    manifest.push(module);
    await writeFile(
      join(path!, "precache-manifest.json"),
      JSON.stringify(manifest),
    );
    const worker = await readFile(join(path!, "sw.js"), "utf8");
    await writeFile(
      join(path!, "sw.js"),
      worker.replace(
        /synapse-assets-[a-f0-9]{64}/g,
        `synapse-assets-update-test-${version}`,
      ),
    );
    const html = await readFile(join(path!, "index.html"), "utf8");
    await writeFile(
      join(path!, "index.html"),
      html.replace("<body>", `<body data-test-build="${version}">`),
    );
  }
  let active = one;
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url!, "http://localhost").pathname;
    if (
      ["/auth", "/v1", "/updates"].some((prefix) => pathname.startsWith(prefix))
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    const file = resolve(
      active,
      pathname === "/" || !extname(pathname) ? "index.html" : pathname.slice(1),
    );
    if (!file.startsWith(active + "/")) {
      res.writeHead(400);
      res.end();
      return;
    }
    try {
      const bytes = await readFile(file);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Type",
        (
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
            ".json": "application/json",
          } as Record<string, string>
        )[extname(file)] ?? "application/octet-stream",
      );
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const context = await browser.newContext();
  try {
    const old = await context.newPage();
    await old.goto(`http://127.0.0.1:${port}/`);
    await old.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() =>
        old.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true);
    const next = await context.newPage();
    await next.goto(`http://127.0.0.1:${port}/`);
    active = two;
    await next.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await expect
      .poll(
        () =>
          next.evaluate(async () =>
            Boolean((await navigator.serviceWorker.ready).waiting),
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    await context.setOffline(true);
    expect(
      await old.evaluate(async () => {
        const path = "/assets/lazy-one.js";
        return (await import(path)).value;
      }),
    ).toBe("one");
    await context.setOffline(false);
    await next.evaluate(async () => {
      const waiting = (await navigator.serviceWorker.ready).waiting!;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Activation timeout")),
          15000,
        );
        waiting.addEventListener("statechange", () => {
          if (waiting.state === "activated") {
            clearTimeout(timer);
            resolve();
          }
        });
        waiting.postMessage({ type: "SYNAPSE_ACTIVATE_UPDATE" });
      });
    });
    await next.reload();
    await expect(next.locator("body")).toHaveAttribute(
      "data-test-build",
      "two",
    );
    await context.setOffline(true);
    expect(
      await next.evaluate(async () => {
        const path = "/assets/lazy-two.js";
        return (await import(path)).value;
      }),
    ).toBe("two");
    expect(
      await old.evaluate(async () => {
        const response = await fetch("/assets/lazy-one.js");
        return response.text();
      }),
    ).toContain("one");
  } finally {
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
