import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const binary = path.join(
  desktopRoot,
  "src-tauri",
  "target",
  "debug",
  process.platform === "win32" ? "synapse-desktop.exe" : "synapse-desktop",
);
let driver;

async function webdriver(pathname, init) {
  const response = await fetch(`http://127.0.0.1:4444${pathname}`, init);
  const body = await response.json();
  if (!response.ok || body.value?.error)
    throw new Error(body.value?.message ?? `WebDriver ${response.status}`);
  return body.value;
}

async function waitForDriver() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await webdriver("/status");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("tauri-driver did not start");
}

try {
  driver = spawn("tauri-driver", [], { stdio: "inherit" });
  await waitForDriver();
  let session;
  const deadline = Date.now() + 20_000;
  while (!session && Date.now() < deadline) {
    try {
      session = await webdriver("/session", {
        body: JSON.stringify({
          capabilities: {
            alwaysMatch: {
              browserName: "wry",
              "tauri:options": { application: binary },
            },
          },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!session)
    throw new Error("native WebDriver did not create a Tauri session");
  const sessionId = session.sessionId;
  try {
    const title = await webdriver(`/session/${sessionId}/title`);
    if (title !== "Synapse")
      throw new Error(`unexpected native title: ${title}`);
    const deadline = Date.now() + 10_000;
    let login;
    while (!login && Date.now() < deadline) {
      try {
        login = await webdriver(`/session/${sessionId}/element`, {
          body: JSON.stringify({
            using: "css selector",
            value: 'input[type="email"]',
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!login) throw new Error("shared web login is not rendered in Tauri");
  } finally {
    await webdriver(`/session/${sessionId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  }
} finally {
  driver?.kill();
  if (driver) await once(driver, "exit").catch(() => undefined);
}
