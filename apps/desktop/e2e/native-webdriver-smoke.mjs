import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Builder, By, Capabilities, until } from "selenium-webdriver";

import { resolveDesktopBinaryPath } from "./native-webdriver-path.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const appBinary = resolveDesktopBinaryPath(root, process.platform);
const frontendDist = path.join(root, "apps/desktop/dist");
const webdriverPort = 4444;
const timeoutMs = 60_000;

function findCommand(command) {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`preflight: ${command} is required on PATH`);
  }
  return result.stdout.trim().split(/\r?\n/, 1)[0];
}

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${label} exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${label} failed (exit ${code ?? "null"}, signal ${signal ?? "none"})`,
          ),
        );
      }
    });
  });
}

async function waitForDriver() {
  const deadline = Date.now() + timeoutMs;
  let lastError = "driver did not answer";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${webdriverPort}/status`);
      if (response.ok) {
        return;
      }
      lastError = `driver returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `tauri-driver was not ready within ${timeoutMs}ms: ${lastError}`,
  );
}

async function stop(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function main() {
  const tauriDriver = findCommand("tauri-driver");
  const nativeDriver =
    process.platform === "linux" ? findCommand("WebKitWebDriver") : undefined;

  if (process.platform === "linux" && !process.env.DISPLAY) {
    throw new Error(
      "preflight: DISPLAY is required on Linux; run this smoke under xvfb-run -a or a desktop session",
    );
  }

  await rm(frontendDist, { force: true, recursive: true });
  await run(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@synapse/desktop",
      "tauri",
      "build",
      "--debug",
      "--no-bundle",
    ],
    "native desktop build",
  );
  await access(appBinary);

  const driverArgs = ["--port", String(webdriverPort)];
  if (nativeDriver) {
    driverArgs.push("--native-driver", nativeDriver);
  }
  const driverProcess = spawn(tauriDriver, driverArgs, { stdio: "inherit" });
  const driverFailure = new Promise((_, reject) => {
    driverProcess.once("error", reject);
  });
  let driver;
  try {
    await Promise.race([waitForDriver(), driverFailure]);

    const capabilities = new Capabilities();
    capabilities.set("browserName", "wry");
    capabilities.set("tauri:options", { application: appBinary });
    driver = await new Builder()
      .usingServer(`http://127.0.0.1:${webdriverPort}`)
      .withCapabilities(capabilities)
      .build();

    await driver.wait(until.titleIs("Synapse"), timeoutMs);
    await driver.wait(until.elementLocated(By.id("login-email")), timeoutMs);
    await driver.wait(until.elementLocated(By.id("login-password")), timeoutMs);
    const heading = await driver.findElement(By.css(".auth-card h2")).getText();
    assert.equal(heading, "Bon retour.");
  } finally {
    await driver?.quit().catch(() => undefined);
    await stop(driverProcess);
  }
}

await main();
console.log("Native Tauri WebDriver smoke passed.");
