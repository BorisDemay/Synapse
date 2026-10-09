import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  assertPortFree,
  waitForReady,
  stopProcess,
  databaseName,
} from "./lifecycle.mjs";

test("occupied ports are rejected without touching the listener", async () => {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(
      assertPortFree(listener.address().port),
      /already occupied/,
    );
    assert.equal(listener.listening, true);
  } finally {
    listener.close();
  }
});
test("readiness rejects an exited child even if HTTP is healthy", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(1)"]);
  await new Promise((resolve) => child.once("exit", resolve));
  await assert.rejects(
    waitForReady(child, "http://127.0.0.1:1", 100),
    /exited/,
  );
});
test("cleanup terminates and reaps a started process", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  await new Promise((resolve) => child.once("spawn", resolve));
  await stopProcess(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});
test("database names are unique disposable identifiers", () => {
  const first = databaseName();
  assert.match(first, /^synapse_e2e_[a-f0-9]{24}$/);
  assert.notEqual(first, databaseName());
});
test("invalid ports are rejected before binding", async () => {
  for (const port of [0, -1, 65536, NaN])
    await assert.rejects(assertPortFree(port), /Invalid test port/);
});
test(
  "cleanup escalates a real child that ignores graceful termination",
  { skip: process.platform === "win32" },
  async () => {
    const child = spawn(process.execPath, [
      "-e",
      "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)",
    ]);
    await new Promise((resolve) => child.stdout.once("data", resolve));
    await stopProcess(child, { graceMs: 20, forcedExitMs: 1000 });
    assert.equal(child.signalCode, "SIGKILL");
  },
);
test("cleanup rejects within its deadline when a child never confirms exit", async () => {
  const { EventEmitter } = await import("node:events");
  const child = new EventEmitter();
  child.pid = 1;
  child.exitCode = null;
  child.signalCode = null;
  const signals = [];
  child.kill = (signal) => signals.push(signal);
  await assert.rejects(
    stopProcess(child, { graceMs: 5, forcedExitMs: 10 }),
    /did not exit/,
  );
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.listenerCount("exit"), 0);
});
