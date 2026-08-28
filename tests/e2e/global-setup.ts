import { spawn, spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const workdir = join(root, "target", "e2e-smoke");
const serverUrl = "http://127.0.0.1:3000/health/ready";

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

async function waitForReady(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(serverUrl, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Synapse API did not become ready at ${serverUrl}`);
}

async function stopServer(server: ReturnType<typeof spawn>): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

export default async function globalSetup() {
  await rm(workdir, { force: true, recursive: true });
  run("just", ["db"]);
  run("cargo", ["build", "-p", "synapse-server"]);

  const server = spawn(join(root, "target", "debug", "synapse-server"), [], {
    cwd: root,
    env: {
      ...process.env,
      SYNAPSE_ALLOWED_ORIGIN: "http://127.0.0.1:5173",
      SYNAPSE_ALLOW_PUBLIC_SIGNUP: "true",
      SYNAPSE_BIND_ADDR: "127.0.0.1:3000",
      SYNAPSE_COOKIE_SECURE: "false",
      SYNAPSE_DATABASE_URL: "postgres://postgres@127.0.0.1:55432/synapse_dev",
      SYNAPSE_ENV: "development",
      SYNAPSE_MAIL_DIRECTORY: join(workdir, "mail"),
      SYNAPSE_STORAGE_PATH: join(workdir, "blobs"),
    },
    stdio: "ignore",
  });

  try {
    await waitForReady();
  } catch (error) {
    await stopServer(server);
    await rm(workdir, { force: true, recursive: true });
    throw error;
  }

  return async () => {
    await stopServer(server);
    await rm(workdir, { force: true, recursive: true });
  };
}
