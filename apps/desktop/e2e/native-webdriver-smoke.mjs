import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Builder, By, Capabilities, Key, until } from "selenium-webdriver";
import {
  availablePort,
  startTestBackend,
} from "../../../tests/harness/backend.mjs";
import {
  stopProcess,
  waitForReady,
} from "../../../tests/harness/lifecycle.mjs";
import { resolveDesktopBinaryPath } from "./native-webdriver-path.mjs";
import { nativeTestConfig } from "./native-webdriver-config.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const timeout = 30000;
const phrase = "synthetic native recovery passphrase";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const store = (name) =>
  `document.getElementById("app").__vue_app__.config.globalProperties.$pinia._s.get(${JSON.stringify(name)})`;
function run(command, args, options = {}) {
  const { timeoutMs = 30000, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      detached: process.platform !== "win32",
      ...spawnOptions,
    });
    const timer = setTimeout(() => {
      if (process.platform === "win32")
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          timeout: 10000,
          stdio: "ignore",
        });
      else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`));
    });
  });
}
async function poll(check, label, limit = timeout) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    try {
      if (await check()) return;
    } catch {
      /* retry a transient UI/filesystem state */
    }
    await pause(100);
  }
  if (process.platform === "linux") {
    const windows = spawnSync(
      "xdotool",
      ["search", "--onlyvisible", "--name", "."],
      { encoding: "utf8" },
    );
    for (const id of windows.stdout.trim().split("\n").filter(Boolean))
      console.error(
        "Visible test window:",
        spawnSync("xdotool", ["getwindowname", id], {
          encoding: "utf8",
        }).stdout.trim(),
      );
  }
  throw new Error(`Timed out: ${label}`);
}
async function nativePicker(directory) {
  if (process.platform === "linux") {
    let window;
    await poll(() => {
      const result = spawnSync(
        "xdotool",
        [
          "search",
          "--onlyvisible",
          "--name",
          "Choisir un dossier de coffre Synapse",
        ],
        { encoding: "utf8" },
      );
      window = result.stdout?.trim().split("\n").at(-1);
      return result.status === 0 && window;
    }, "native folder dialog");
    await run("xdotool", ["windowfocus", "--sync", window]);
    const key = (keys) => run("xdotool", ["key", "--clearmodifiers", keys]);
    if (!directory) {
      await key("Escape");
      await poll(
        () =>
          spawnSync("xdotool", [
            "search",
            "--onlyvisible",
            "--name",
            "Choisir un dossier de coffre Synapse",
          ]).status !== 0,
        "native cancellation closes dialog",
      );
      await pause(150);
      return;
    }
    await key("alt+Home");
    await pause(300);
    await key("ctrl+l");
    await key("ctrl+a");
    await run("xdotool", ["type", "--clearmodifiers", "--", directory]);
    await key("Return");
    await pause(500);
    const exists = spawnSync(
      "xdotool",
      [
        "search",
        "--onlyvisible",
        "--name",
        "Choisir un dossier de coffre Synapse",
      ],
      { encoding: "utf8" },
    );
    if (exists.status === 0) await key("Return");
    spawnSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "x11grab",
        "-video_size",
        "1280x1024",
        "-i",
        process.env.DISPLAY,
        "-frames:v",
        "1",
        path.join(tmpdir(), "synapse-native-picker.png"),
        "-loglevel",
        "error",
      ],
      { timeout: 5000, stdio: "ignore" },
    );
    await poll(
      () =>
        spawnSync("xdotool", [
          "search",
          "--onlyvisible",
          "--name",
          "Choisir un dossier de coffre Synapse",
        ]).status !== 0,
      "native selection closes dialog",
    );
  } else {
    const keys = directory ? ["%d", directory, "{ENTER}", "%s"] : ["{ESC}"];
    const script = `$shell = New-Object -ComObject WScript.Shell; $end=(Get-Date).AddSeconds(30); while (!( $shell.AppActivate('Choisir un dossier de coffre Synapse'))) { if((Get-Date)-gt $end){throw 'folder dialog timeout'}; Start-Sleep -Milliseconds 100 }; ${keys.map((value) => `$shell.SendKeys('${value.replaceAll("'", "''")}'); Start-Sleep -Milliseconds 300;`).join(" ")}`;
    await run("powershell", ["-NoProfile", "-Command", script]);
  }
}
async function readNotes(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await readNotes(file)));
    else if (entry.name.endsWith(".md"))
      result.push({ file, content: await readFile(file, "utf8") });
  }
  return result;
}

const temporary = await mkdtemp(path.join(tmpdir(), "synapse-native-e2e-"));
const identifier = `org.synapse.e2e.${path.basename(temporary).toLowerCase()}`;
const windowsOwnedProfiles =
  process.platform === "win32"
    ? [process.env.APPDATA, process.env.LOCALAPPDATA]
        .filter(Boolean)
        .map((base) => path.join(base, identifier))
    : [];
for (const profile of windowsOwnedProfiles) {
  await assert.rejects(
    access(profile),
    { code: "ENOENT" },
    "test profile must be unused",
  );
}
const env = {
  ...process.env,
  XDG_CONFIG_HOME: path.join(temporary, "config"),
  XDG_DATA_HOME: path.join(temporary, "data"),
  XDG_CACHE_HOME: path.join(temporary, "cache"),
  WEBKIT_DISABLE_DMABUF_RENDERER: "1",
  GDK_BACKEND: "x11",
  WAYLAND_DISPLAY: "",
  ...(process.platform === "win32"
    ? {
        APPDATA: path.join(temporary, "roaming"),
        LOCALAPPDATA: path.join(temporary, "local"),
      }
    : {}),
};
let driverProcess, driver, backend, windowManager, windowsApp;
function stopWindowsApp() {
  if (!windowsApp?.pid) return;
  spawnSync("taskkill", ["/PID", String(windowsApp.pid), "/T", "/F"], {
    timeout: 10000,
    stdio: "ignore",
  });
  windowsApp = undefined;
}
async function quitDriver() {
  if (!driver) return;
  await Promise.race([
    driver.quit(),
    pause(10000).then(() => {
      throw new Error("Native session quit timed out");
    }),
  ]);
  driver = undefined;
  stopWindowsApp();
}
async function stopDriverTree() {
  stopWindowsApp();
  if (!driverProcess?.pid) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/PID", String(driverProcess.pid), "/T", "/F"], {
      timeout: 10000,
      stdio: "ignore",
    });
  else {
    try {
      process.kill(-driverProcess.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}
const watchdog = setTimeout(() => {
  console.error("Native scenario deadline exceeded");
  void stopDriverTree();
}, 1200000);
try {
  if (process.platform === "linux") {
    windowManager = spawn("openbox", [], { env, stdio: "ignore" });
    windowManager.on("error", () => {});
  }
  for (const directory of [
    env.XDG_CONFIG_HOME,
    env.XDG_DATA_HOME,
    env.XDG_CACHE_HOME,
    path.join(temporary, "local-folder"),
  ])
    await mkdir(directory, { recursive: true });
  const offlinePort = await availablePort();
  const webdriverPort = await availablePort();
  const nativePort = await availablePort();
  const debugPort =
    process.platform === "win32" ? await availablePort() : undefined;
  const config = JSON.parse(
    await readFile(
      path.join(root, "apps/desktop/src-tauri/tauri.conf.json"),
      "utf8",
    ),
  );
  const override = path.join(temporary, "tauri-e2e.json");
  await writeFile(
    override,
    JSON.stringify(
      nativeTestConfig(config, {
        identifier,
        dataDirectory: path.join(temporary, "webview"),
        platform: process.platform,
        debugPort,
      }),
    ),
  );
  await run(
    process.execPath,
    [
      createRequire(import.meta.url).resolve("@tauri-apps/cli/tauri.js"),
      "build",
      "--debug",
      "--no-bundle",
      "--config",
      override,
    ],
    {
      cwd: path.join(root, "apps/desktop"),
      timeoutMs: 900000,
      env: {
        ...env,
        VITE_SYNAPSE_INSTANCE_URL: `http://127.0.0.1:${offlinePort}`,
      },
    },
  );
  const binary = resolveDesktopBinaryPath(root, process.platform);
  await access(binary);
  const args = [
    "--port",
    String(webdriverPort),
    "--native-port",
    String(nativePort),
  ];
  if (process.platform === "linux") {
    const resolved = spawnSync("which", ["WebKitWebDriver"], {
      encoding: "utf8",
    });
    if (resolved.status !== 0) throw new Error("WebKitWebDriver missing");
    args.push("--native-driver", resolved.stdout.trim());
  }
  driverProcess = spawn(
    process.platform === "win32" ? "msedgedriver" : "tauri-driver",
    process.platform === "win32" ? [`--port=${webdriverPort}`] : args,
    {
      env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    },
  );
  await waitForReady(driverProcess, `http://127.0.0.1:${webdriverPort}/status`);
  async function launch() {
    const capabilities = new Capabilities();
    capabilities.set(
      "browserName",
      process.platform === "win32" ? "webview2" : "wry",
    );
    capabilities.set("unhandledPromptBehavior", "accept");
    if (process.platform === "win32") {
      windowsApp = spawn(binary, [], {
        env,
        stdio: "inherit",
      });
      await waitForReady(
        windowsApp,
        `http://127.0.0.1:${debugPort}/json/version`,
        60000,
      );
      capabilities.set("ms:edgeOptions", {
        debuggerAddress: `127.0.0.1:${debugPort}`,
      });
      console.log("Windows WebView2 debugging endpoint ready");
    } else {
      capabilities.set("tauri:options", { application: binary });
    }
    driver = await new Builder()
      .usingServer(`http://127.0.0.1:${webdriverPort}`)
      .withCapabilities(capabilities)
      .build();
    await driver
      .manage()
      .setTimeouts({ script: timeout, pageLoad: timeout, implicit: 0 });
    await driver.wait(until.titleIs("Synapse"), timeout);
    if (process.platform === "linux") {
      const window = spawnSync(
        "xdotool",
        ["search", "--onlyvisible", "--name", "^Synapse$"],
        { encoding: "utf8" },
      )
        .stdout.trim()
        .split("\n")
        .at(-1);
      if (window) await run("xdotool", ["windowfocus", "--sync", window]);
    }
  }
  const button = (text) =>
    driver.findElement(
      By.xpath(`//button[normalize-space(.)=${JSON.stringify(text)}]`),
    );
  const field = (id) => driver.findElement(By.id(id));
  async function waitVault() {
    await driver.wait(
      until.elementLocated(
        By.css('[aria-label="Éditeur Markdown"][contenteditable="true"]'),
      ),
      timeout,
    );
  }
  async function createVault(folder, cancelFirst = false) {
    await driver.wait(
      until.elementLocated(By.id("unlock-passphrase")),
      timeout,
    );
    const select = await driver.findElement(
      By.css('select[aria-label="Dossier Markdown local"]'),
    );
    await select.findElement(By.css('option[value="choose"]')).click();
    assert.equal(
      await select.getAttribute("value"),
      "choose",
      "must choose temporary folder before creation",
    );
    if (cancelFirst) {
      await (await field("unlock-passphrase")).sendKeys(phrase);
      await driver.findElement(By.css('form button[type="submit"]')).click();
      await nativePicker();
      await poll(
        async () =>
          (
            await driver.findElements(
              By.css('select[aria-label="Dossier Markdown local"]'),
            )
          ).length === 1,
        "picker cancellation",
      );
      assert.equal(
        await driver.executeAsyncScript(
          `const done=arguments[arguments.length-1]; ${store("vault")}.listVaultIds().then(ids=>done(ids.length));`,
        ),
        0,
      );
    }
    await (await field("unlock-passphrase")).sendKeys(phrase);
    await driver.findElement(By.css('form button[type="submit"]')).click();
    await nativePicker(folder);
    await waitVault();
  }
  async function edit(text, folder) {
    await (await button("Texte brut")).click();
    const editor = await driver.wait(
      until.elementLocated(
        By.css('[aria-label="Éditeur Markdown"][contenteditable="true"]'),
      ),
      timeout,
    );
    await editor.click();
    await editor.sendKeys(Key.chord(Key.CONTROL, "a"), Key.BACK_SPACE);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i) await editor.sendKeys(Key.ENTER);
      if (lines[i]) await editor.sendKeys(lines[i]);
    }
    await poll(
      async () =>
        (await readNotes(folder)).some((note) =>
          note.content.includes(text.trim()),
        ),
      "durable native Markdown replica",
    );
  }
  await launch();
  await driver.wait(until.elementLocated(By.id("login-email")), timeout);
  await (await button("Choisir un coffre local")).click();
  const localFolder = path.join(temporary, "local-folder");
  await createVault(localFolder, true);
  console.log("Native local vault created in chosen temporary folder");
  await edit("# Native recovery\n\nFirst durable native version.", localFolder);
  await quitDriver();
  await launch();
  await driver.wait(until.elementLocated(By.id("unlock-passphrase")), timeout);
  await (await field("unlock-passphrase")).sendKeys(phrase);
  await driver.findElement(By.css('form button[type="submit"]')).click();
  await waitVault();
  await driver.findElement(By.css('[role="treeitem"]')).click();
  assert.match(
    await driver
      .findElement(
        By.css('[aria-label="Éditeur Markdown"][contenteditable="true"]'),
      )
      .getText(),
    /First durable native version/,
  );
  console.log(
    JSON.stringify({
      native_local_create_edit_restart: "passed",
      picker_cancel_select: "passed",
      replica_bytes: "passed",
    }),
  );
  async function vaultCall(body) {
    const outcome = await driver.executeAsyncScript(
      `const done=arguments[arguments.length-1]; const vault=${store("vault")}; Promise.resolve().then(async()=>{${body}}).then(value=>done({ok:true,value})).catch(()=>done({ok:false}));`,
    );
    assert.equal(outcome.ok, true, "native vault action completed");
    return outcome.value;
  }
  await vaultCall(
    'await vault.saveAttachment({path:"attachments/native.bin",bytes:new Uint8Array([1,2,3,4]),contentType:"application/octet-stream"});',
  );
  await poll(
    async () =>
      (await readFile(path.join(localFolder, "attachments/native.bin"))).equals(
        Buffer.from([1, 2, 3, 4]),
      ),
    "native attachment bytes",
  );
  const localNoteId = await vaultCall("return [...vault.notes.keys()][0];");
  await vaultCall(
    `await vault.createRestorePoint(${JSON.stringify(localNoteId)}, "native checkpoint");`,
  );
  await edit(
    "# Native recovery\n\nSecond durable native version.",
    localFolder,
  );
  await vaultCall(
    `await vault.restoreRevision(${JSON.stringify(localNoteId)}, vault.restorePointsFor(${JSON.stringify(localNoteId)})[0].revision);`,
  );
  await poll(
    async () =>
      (await readNotes(localFolder)).some((note) =>
        note.content.includes("First durable native version."),
      ),
    "native history restore",
  );
  console.log("Native attachment and history restoration passed");

  backend = await startTestBackend({ root });
  const email = `native-${Date.now()}@example.test`;
  const password = "synthetic native account password";
  const api = async (endpoint, body, cookie) =>
    fetch(`${backend.baseUrl}${endpoint}`, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        Origin: backend.baseUrl,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeout),
    });
  assert.equal((await api("/auth/signup", { email, password })).status, 201);
  const mailFile = path.join(backend.mailDirectory, `${email}.eml`);
  await poll(
    async () => (await readFile(mailFile, "utf8")).includes("token="),
    "native synthetic activation mail",
  );
  const mail = await readFile(mailFile, "utf8");
  const token = new URL(mail.match(/https?:\/\/\S+/)[0]).searchParams.get(
    "token",
  );
  assert.equal((await api("/auth/activate", { token })).status, 204);
  await driver.findElement(By.css('[aria-label="Se déconnecter"]')).click();
  await driver.wait(until.elementLocated(By.id("login-email")), timeout);
  await (await field("login-instance")).clear();
  await (await field("login-instance")).sendKeys(backend.baseUrl);
  await (await field("login-email")).sendKeys(email);
  await (await field("login-password")).sendKeys(password);
  await (await field("login-remember-device")).click();
  await (await button("Se connecter")).click();
  const serverFolder = path.join(temporary, "server-folder");
  await mkdir(serverFolder);
  await createVault(serverFolder);
  await edit("# Native shared\n\nBaseline shared line.", serverFolder);
  await poll(
    async () =>
      await driver.executeScript(
        `return ${store("vault")}.syncStatus === "synced" && ${store("vault")}.pendingNoteIds.length === 0;`,
      ),
    "native server acknowledgement",
  );
  const vaultId = await vaultCall("return vault.currentVaultId;");
  const noteId = await vaultCall("return [...vault.notes.keys()][0];");
  const notePath = await vaultCall(
    `return vault.notes.get(${JSON.stringify(noteId)}).path;`,
  );
  const baselineRevision = await vaultCall("return vault.headRevision;");
  const login = await api("/auth/login", { email, password });
  assert.equal(login.status, 204);
  const cookie = login.headers
    .getSetCookie()
    .find((value) => value.startsWith("session="))
    .split(";", 1)[0];
  const envelope = await (
    await api(`/v1/vaults/${vaultId}/envelope`, undefined, cookie)
  ).json();
  const { parseWrappedVaultKey, unlockVaultKey, uuidV7 } = await import(
    "../../web/src/crypto/vault-key.ts"
  );
  const { encodeNotePlaintext } = await import(
    "../../web/src/crypto/vault-item.ts"
  );
  const { xchacha20poly1305 } = await import(
    "../../web/node_modules/@noble/ciphers/chacha.js"
  );
  const key = await unlockVaultKey(
    parseWrappedVaultKey(envelope.bytes),
    phrase,
  );
  await driver.executeScript(
    `localStorage.setItem("synapse-instance-url", arguments[0]); window.dispatchEvent(new Event("online"));`,
    `http://127.0.0.1:${offlinePort}`,
  );
  await edit("# Native shared\n\nOffline native competing line.", serverFolder);
  await poll(
    async () =>
      await driver.executeScript(
        `return ${store("vault")}.pendingNoteIds.length > 0;`,
      ),
    "native persistent pending edit",
  );
  await quitDriver();
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const ciphertext = xchacha20poly1305(
    key,
    nonce,
    new TextEncoder().encode(
      `synapse/aad/1/${vaultId}/${noteId}/${baselineRevision}`,
    ),
  ).encrypt(
    encodeNotePlaintext(notePath, "# Native shared\n\nRemote competing line."),
  );
  key.fill(0);
  const operation = {
    protocol_version: 1,
    aad_version: 1,
    operation_id: uuidV7(),
    vault_id: vaultId,
    note_id: noteId,
    base_revision: baselineRevision,
    nonce: Array.from(nonce),
    ciphertext: Array.from(ciphertext),
    ciphertext_hash: createHash("sha256").update(ciphertext).digest("hex"),
  };
  assert.equal(
    (await api(`/v1/vaults/${vaultId}/operations`, operation, cookie)).status,
    201,
  );
  await launch();
  await driver.wait(until.elementLocated(By.id("unlock-passphrase")), timeout);
  await (await field("unlock-passphrase")).sendKeys(phrase);
  await driver.findElement(By.css('form button[type="submit"]')).click();
  await waitVault();
  assert.equal(
    await vaultCall(
      `return vault.notes.get(${JSON.stringify(noteId)}).content.includes("Offline native competing line.");`,
    ),
    true,
  );
  await driver.executeScript(
    `localStorage.setItem("synapse-instance-url", arguments[0]); window.dispatchEvent(new Event("online"));`,
    backend.baseUrl,
  );
  await driver.wait(
    until.elementLocated(By.css('pre[aria-label="Version locale"]')),
    timeout,
  );
  assert.match(
    await driver
      .findElement(By.css('pre[aria-label="Version locale"]'))
      .getText(),
    /Offline native competing line/,
  );
  assert.match(
    await driver
      .findElement(By.css('pre[aria-label="Version distante"]'))
      .getText(),
    /Remote competing line/,
  );

  const keepLocal = await driver.findElement(
    By.css('[aria-label="Garder la version locale"]'),
  );
  await driver.executeScript(
    "arguments[0].scrollIntoView({block: 'center'});",
    keepLocal,
  );
  await keepLocal.click();
  // The native driver accepts the intentional conflict confirmation via its
  // explicit unhandledPromptBehavior capability; then we require durable ack.
  await poll(
    async () =>
      await driver.executeScript(
        `return ${store("vault")}.syncStatus === "synced" && !${store("vault")}.activeConflict;`,
      ),
    "native conflict resolution acknowledgement",
  );
  await poll(
    async () =>
      (await readNotes(serverFolder)).some((note) =>
        note.content.includes("Offline native competing line."),
      ),
    "resolved native replica",
  );
  console.log(
    JSON.stringify({
      native_offline_restart_reconnect: "passed",
      native_conflict_resolution: "passed",
      native_history_restore: "passed",
      native_attachment: "passed",
    }),
  );
} catch (error) {
  if (driver) {
    await writeFile(
      path.join(tmpdir(), "synapse-native-failure.png"),
      await Promise.race([
        driver.takeScreenshot().catch(() => ""),
        pause(3000).then(() => ""),
      ]),
      "base64",
    );
    await writeFile(
      path.join(tmpdir(), "synapse-native-failure.html"),
      await Promise.race([
        driver.getPageSource().catch(() => ""),
        pause(3000).then(() => ""),
      ]),
    );
  }
  throw error;
} finally {
  clearTimeout(watchdog);
  await Promise.race([driver?.quit().catch(() => {}), pause(5000)]);
  await stopDriverTree();
  const cleanup = await Promise.allSettled([
    backend?.close(),
    windowManager ? stopProcess(windowManager) : Promise.resolve(),
  ]);
  if (!process.env.SYNAPSE_KEEP_NATIVE_TEST_PROFILE) {
    cleanup.push(
      ...(await Promise.allSettled(
        [temporary, ...windowsOwnedProfiles].map((profile) =>
          rm(profile, { recursive: true, force: true }),
        ),
      )),
    );
  } else console.log(`Native test artifacts: ${temporary}`);
  if (cleanup.some((result) => result.status === "rejected")) {
    console.error("Native test cleanup failed for an owned resource");
    process.exitCode = 1;
  }
}
