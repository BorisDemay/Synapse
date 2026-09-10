// Local-only, bounded security assessment. Exit 0 means the assessment completed,
// NOT that its security checks passed. Findings are explicit in the JSON report.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { startTestBackend } from "../harness/backend.mjs";

// Never inherit remote database, SMTP or bootstrap settings into this assessment.
for (const name of Object.keys(process.env)) {
  if (name.startsWith("SYNAPSE_")) delete process.env[name];
}
const results = [];
function check(name, secure, observed, failureOutcome = "FINDING") {
  const outcome = secure ? "PASS" : failureOutcome;
  results.push({ name, outcome, observed });
  console.log(`${outcome}: ${name} — ${JSON.stringify(observed)}`);
}
const backend = await startTestBackend();
const origin = backend.baseUrl;
assert.equal(new URL(origin).hostname, "127.0.0.1");
const sockets = [];
let browser, hostileServer;
let requests = 0;
async function request(path, { cookie, ip, hostile = false, method = "GET", body, contentType = "application/json" } = {}) {
  assert.ok(++requests <= 90, "bounded request budget");
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      Origin: hostile ? "https://hostile.example.test" : origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(ip ? { "X-Forwarded-For": ip } : {}),
      ...(body !== undefined ? { "Content-Type": contentType } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, headers: response.headers, text: await response.text() };
}
async function login(email, password, ip) {
  const response = await request("/auth/login", { method: "POST", ip, body: { email, password } });
  assert.equal(response.status, 204, "fixture login");
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}
function operation(vaultId, revision = 0) {
  // Opaque random server-bound fixture, never note content or a real vault key.
  const bytes = randomBytes(32);
  const id = randomUUID().split("");
  id[14] = "7";
  return { protocol_version: 1, operation_id: id.join(""), vault_id: vaultId,
    note_id: randomUUID(), base_revision: revision, ciphertext: [...bytes],
    nonce: [...randomBytes(24)], aad_version: 1,
    ciphertext_hash: createHash("sha256").update(bytes).digest("hex") };
}
async function websocket(vaultId, cookie, hostile = false) {
  const address = new URL(origin);
  const socket = connect({ host: address.hostname, port: Number(address.port) });
  sockets.push(socket);
  let received = Buffer.alloc(0);
  socket.on("data", (chunk) => { received = Buffer.concat([received, chunk]); });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
    socket.setTimeout(5000, () => socket.destroy(new Error("Socket deadline")));
  });
  socket.write(`GET /v1/vaults/${vaultId}/ws HTTP/1.1\r\nHost: ${address.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nOrigin: ${hostile ? "https://hostile.example.test" : origin}\r\nCookie: ${cookie}\r\n\r\n`);
  const deadline = Date.now() + 3000;
  while (!received.includes("\r\n\r\n") && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(received.includes("\r\n\r\n"), "WebSocket handshake response");
  const status = Number(received.toString().match(/^HTTP\/1.1 (\d+)/)?.[1]);
  return { socket, status, hasNotice: () => received.subarray(received.indexOf("\r\n\r\n") + 4).includes(Buffer.from('"cursor"')) };
}

try {
  const owner = await login("test", "test", "192.0.2.1");
  check("Development fixture account is usable", false, { status: 204, scope: "explicit development harness only; not a production-mode bypass" }, "OBSERVATION");
  const writer = await login("test", "test", "192.0.2.2");
  const email = `assessment-${randomUUID()}@example.test`;
  const password = randomBytes(24).toString("hex");
  assert.equal((await request("/auth/signup", { method: "POST", ip: "192.0.2.3", body: { email, password } })).status, 201);
  const mail = await readFile(join(backend.mailDirectory, `${email}.eml`), "utf8");
  const token = new URL(mail.match(/https?:\/\/\S+/)[0]).searchParams.get("token");
  assert.equal((await request("/auth/activate", { method: "POST", ip: "192.0.2.4", body: { token } })).status, 204);
  const stranger = await login(email, password, "192.0.2.5");
  const created = await request("/vaults", { method: "POST", cookie: owner, body: {} });
  assert.equal(created.status, 201);
  const vaultId = JSON.parse(created.text).id;
  const route = `/v1/vaults/${vaultId}`;
  assert.equal((await request(`${route}/envelope`, { method: "PUT", cookie: owner, body: { bytes: [...randomBytes(48)] } })).status, 204);

  for (const path of [`/vaults/${vaultId}`, `${route}/envelope`, `${route}/operations?limit=100`]) {
    const unauth = await request(path);
    check(`Unauthenticated read ${path.replaceAll(vaultId, "<vault>")}`, unauth.status === 401, { status: unauth.status });
    const other = await request(path, { cookie: stranger });
    check(`Cross-account read ${path.replaceAll(vaultId, "<vault>")}`, other.status === 404, { status: other.status });
  }
  const crossPush = await request(`${route}/operations`, { method: "POST", cookie: stranger, body: operation(vaultId) });
  check("Cross-account push rejected", crossPush.status === 404, { status: crossPush.status });
  const crossEnvelope = await request(`${route}/envelope`, { method: "PUT", cookie: stranger, body: { bytes: [1] } });
  check("Cross-account envelope overwrite rejected", crossEnvelope.status === 404, { status: crossEnvelope.status });

  const wrongOriginEnvelope = await request(`${route}/envelope`, { method: "PUT", cookie: owner, hostile: true, body: { bytes: [1] } });
  check("Envelope mutation rejects hostile Origin", wrongOriginEnvelope.status === 403, { status: wrongOriginEnvelope.status });
  const wrongOriginCreate = await request("/vaults", { method: "POST", cookie: owner, hostile: true, body: {} });
  check("Vault creation rejects hostile Origin", wrongOriginCreate.status === 403, { status: wrongOriginCreate.status, browserExploitProven: false }, "OBSERVATION");
  const op = operation(vaultId);
  const wrongOriginPush = await request(`${route}/operations`, { method: "POST", cookie: owner, hostile: true, body: op });
  check("Sync push rejects hostile Origin", wrongOriginPush.status === 403, { status: wrongOriginPush.status, browserExploitProven: false }, "OBSERVATION");
  let revision = wrongOriginPush.status === 201 ? JSON.parse(wrongOriginPush.text).revision : 0;
  if (!revision) {
    const legitimate = await request(`${route}/operations`, { method: "POST", cookie: owner, body: op });
    assert.equal(legitimate.status, 201);
    revision = JSON.parse(legitimate.text).revision;
  }
  const simple = await request("/vaults", { method: "POST", cookie: owner, hostile: true, body: {}, contentType: "text/plain" });
  check("Simple cross-origin text/plain mutation rejected", simple.status === 415, { status: simple.status });
  const preflight = await request("/vaults", { method: "OPTIONS", hostile: true });
  check("Hostile origin receives no CORS permission", !preflight.headers.has("access-control-allow-origin"), { status: preflight.status, allowed: preflight.headers.has("access-control-allow-origin") });
  const replay = await request(`${route}/operations`, { method: "POST", cookie: owner, body: op });
  check("Identical operation replay preserves revision", replay.status === 201 && JSON.parse(replay.text).revision === revision, { status: replay.status, sameRevision: replay.status === 201 && JSON.parse(replay.text).revision === revision });
  const altered = { ...op, nonce: [...randomBytes(24)] };
  const tamperReplay = await request(`${route}/operations`, { method: "POST", cookie: owner, body: altered });
  const afterReplay = await request(`${route}/operations?limit=100`, { cookie: owner });
  assert.equal(afterReplay.status, 200);
  const stored = JSON.parse(afterReplay.text).operations.find((item) => item.operation_id === op.operation_id);
  check("Operation identity reused with changed payload rejected", [400, 409].includes(tamperReplay.status), { status: tamperReplay.status, originalPreserved: JSON.stringify(stored.nonce) === JSON.stringify(op.nonce), classification: "hardening opportunity: ADR 0002 returns original durable ack; no overwrite demonstrated" }, "OBSERVATION");
  const badHash = { ...operation(vaultId, revision), ciphertext_hash: "0".repeat(64) };
  const tamper = await request(`${route}/operations`, { method: "POST", cookie: owner, body: badHash });
  check("Ciphertext hash mismatch rejected", tamper.status === 400, { status: tamper.status });
  for (const limit of [0, 101, -1, "1%27%20OR%201=1"]) {
    const response = await request(`${route}/operations?limit=${limit}`, { cookie: owner });
    check(`Invalid pull limit rejected (${limit})`, response.status === 400, { status: response.status });
  }
  const wsOther = await websocket(vaultId, stranger);
  check("Cross-account WebSocket rejected", wsOther.status === 404, { status: wsOther.status });
  wsOther.socket.destroy();
  const wsHostile = await websocket(vaultId, owner, true);
  check("WebSocket rejects hostile Origin", wsHostile.status === 403, { status: wsHostile.status, browserExploitProven: false });
  wsHostile.socket.destroy();
  hostileServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!doctype html><title>Isolated hostile origin test</title>");
  });
  await new Promise((resolve) => hostileServer.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([{ name: "session", value: owner.slice("session=".length), url: origin, httpOnly: true, sameSite: "Strict", secure: false }]);
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${hostileServer.address().port}`);
  const browserSocketOpened = await page.evaluate(async (url) => {
    window.noticeReceived = false;
    return new Promise((resolve) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => { socket.close(); resolve(false); }, 3000);
      socket.onopen = () => { clearTimeout(timer); resolve(true); };
      socket.onerror = () => { clearTimeout(timer); resolve(false); };
      socket.onmessage = (event) => { window.noticeReceived = typeof JSON.parse(event.data).cursor === "string"; };
    });
  }, `${origin.replace("http:", "ws:")}${route}/ws`);
  check("Browser on untrusted same-site origin cannot open authenticated WebSocket", !browserSocketOpened, { opened: browserSocketOpened, sameSiteCookie: "Strict", prerequisite: "attacker-controlled origin on same site (demonstrated using a different loopback port)" });
  const browserMutation = await page.evaluate(async (url) => {
    try {
      const response = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
      return response.status;
    } catch { return "blocked"; }
  }, `${origin}/vaults`);
  check("Browser CORS blocks hostile JSON mutation", browserMutation === "blocked", { result: browserMutation });
  const wsOwner = await websocket(vaultId, owner);
  assert.equal(wsOwner.status, 101);
  assert.equal((await request("/auth/logout", { method: "POST", cookie: owner })).status, 204);
  const revoked = await request("/v1/session", { cookie: owner });
  check("Revoked session rejected by HTTP", revoked.status === 401, { status: revoked.status });
  assert.equal((await request(`${route}/operations`, { method: "POST", cookie: writer, body: operation(vaultId, revision) })).status, 201);
  const noticeDeadline = Date.now() + 1500;
  while (!wsOwner.hasNotice() && !wsOwner.socket.destroyed && Date.now() < noticeDeadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  check("Revoked WebSocket stops receiving notices", !wsOwner.hasNotice(), { receivedAfterLogout: wsOwner.hasNotice(), data: "vault activity and cursor metadata only" });
  await page.waitForFunction(() => window.noticeReceived, undefined, { timeout: 1000 }).catch(() => {});
  const browserNotice = await page.evaluate(() => window.noticeReceived);
  check("Hostile browser receives no notification after victim logout", !browserNotice, { receivedAfterLogout: browserNotice, data: "vault activity and cursor metadata only" });
  wsOwner.socket.destroy();

  const fixed = [], rotated = [];
  for (let i = 0; i < 8; i++) fixed.push((await request("/auth/login", { method: "POST", ip: "198.51.100.1", body: { email: "absent@example.test", password: "invalid" } })).status);
  assert.ok(fixed.includes(429), "rate-limiter positive control");
  for (let i = 0; i < 8; i++) rotated.push((await request("/auth/login", { method: "POST", ip: `203.0.113.${i + 1}`, body: { email: "absent@example.test", password: "invalid" } })).status);
  check("Changing untrusted forwarding headers cannot bypass throttling", rotated.includes(429), { fixed, rotated, scope: "direct isolated API, proxy path not tested" });
} finally {
  for (const socket of sockets) socket.destroy();
  if (browser) await browser.close();
  if (hostileServer) await new Promise((resolve) => hostileServer.close(resolve));
  await backend.close();
}
const report = { completed: true, requests, findings: results.filter((r) => r.outcome === "FINDING").length, observations: results.filter((r) => r.outcome === "OBSERVATION").length, checks: results, cleanup: "Owned API stopped; disposable database, mail and blobs removed" };
await mkdir("target/security", { recursive: true });
await writeFile("target/security/local-penetration.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(`Assessment completed: ${results.length} checks, ${report.findings} findings. Report: target/security/local-penetration.json`);
