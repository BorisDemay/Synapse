import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
export const databaseName = () =>
  `synapse_e2e_${randomBytes(12).toString("hex")}`;
export async function assertPortFree(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid test port");
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", () =>
      reject(new Error(`Test port ${port} is already occupied`)),
    );
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}
export async function waitForReady(child, url, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null)
      throw new Error("Test server exited before readiness");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok && child.exitCode === null && child.signalCode === null)
        return;
    } catch {
      /* Startup may still be in progress. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server readiness timed out");
}
export async function stopProcess(
  child,
  { graceMs = 5000, forcedExitMs = 5000 } = {},
) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  await new Promise((resolve, reject) => {
    const terminate = setTimeout(() => child.kill("SIGKILL"), graceMs);
    const deadline = setTimeout(() => {
      cleanup();
      reject(new Error("Test child did not exit after forced termination"));
    }, graceMs + forcedExitMs);
    const done = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(terminate);
      clearTimeout(deadline);
      child.removeListener("exit", done);
    };
    child.once("exit", done);
    child.kill("SIGTERM");
  });
}
