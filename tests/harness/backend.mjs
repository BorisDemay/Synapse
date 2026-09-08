import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import {
  assertPortFree,
  databaseName,
  stopProcess,
  waitForReady,
} from "./lifecycle.mjs";

export async function availablePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

/** A supplied PostgreSQL URL is an admin connection; every run owns a newly created database. */
export async function startTestBackend({
  root = process.cwd(),
  port,
  origin,
  adminUrl = process.env.SYNAPSE_TEST_DATABASE_URL,
} = {}) {
  port ??= await availablePort();
  await assertPortFree(port);
  const baseUrl = `http://127.0.0.1:${port}`;
  const run = (command, args, env = process.env, timeout = 180000) => {
    const result = spawnSync(command, args, {
      cwd: root,
      env,
      encoding: "utf8",
      timeout,
    });
    if (result.error || result.status !== 0)
      throw new Error(`Test backend prerequisite failed: ${command}`);
  };
  let sql, connection;
  if (adminUrl) {
    const parsed = new URL(adminUrl);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol))
      throw new Error("Invalid test PostgreSQL URL");
    const env = {
      ...process.env,
      PGHOST: parsed.hostname,
      PGPORT: parsed.port || "5432",
      PGUSER: decodeURIComponent(parsed.username),
      PGPASSWORD: decodeURIComponent(parsed.password),
      PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)) || "postgres",
    };
    sql = (statement) =>
      run("psql", ["-v", "ON_ERROR_STOP=1", "-c", statement], env);
    connection = parsed;
  } else {
    run("docker", [
      "compose",
      "-f",
      "infra/docker/compose.test.yml",
      "up",
      "-d",
      "--wait",
    ]);
    sql = (statement) =>
      run("docker", [
        "compose",
        "-f",
        "infra/docker/compose.test.yml",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        statement,
      ]);
    connection = new URL(
      `postgres://postgres@127.0.0.1:${process.env.SYNAPSE_TEST_PG_PORT ?? 55432}/postgres`,
    );
  }
  run("cargo", ["build", "-p", "synapse-server"], process.env, 900000);
  const database = databaseName();
  const directory = await mkdtemp(join(tmpdir(), "synapse-test-backend-"));
  const mailDirectory = join(directory, "mail");
  let child,
    created = false,
    closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      if (child) await stopProcess(child);
    } finally {
      try {
        if (created) sql(`DROP DATABASE "${database}" WITH (FORCE)`);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  };
  try {
    sql(`CREATE DATABASE "${database}"`);
    created = true;
    connection.pathname = `/${database}`;
    child = spawn(
      join(
        root,
        "target",
        "debug",
        `synapse-server${process.platform === "win32" ? ".exe" : ""}`,
      ),
      [],
      {
        cwd: root,
        env: {
          ...process.env,
          SYNAPSE_DATABASE_URL: connection.toString(),
          SYNAPSE_BIND_ADDR: `127.0.0.1:${port}`,
          SYNAPSE_ALLOWED_ORIGIN: origin ?? baseUrl,
          SYNAPSE_ALLOW_PUBLIC_SIGNUP: "true",
          SYNAPSE_COOKIE_SECURE: "false",
          SYNAPSE_ENV: "development",
          SYNAPSE_STORAGE_PATH: join(directory, "blobs"),
          SYNAPSE_MAIL_DIRECTORY: mailDirectory,
        },
        stdio: "ignore",
      },
    );
    let failed = false;
    child.on("error", () => {
      failed = true;
    });
    await waitForReady(child, `${baseUrl}/health/ready`);
    if (failed) throw new Error("Test backend spawn failed");
    return { baseUrl, mailDirectory, close };
  } catch (error) {
    await close();
    throw error;
  }
}
