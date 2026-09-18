import { test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(__dirname, "../..");

function run(command: string, args: string[], cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    throw new Error(
      `${command} ${args.join(" ")} failed (exit ${result.status}):\n${output}`,
    );
  }
  return result;
}

/** This suite proves the local vault commands and Vue shell checks. */
test.describe("desktop local vault path", () => {
  test("Tauri vault commands open a directory without a window", () => {
    run("cargo", [
      "test",
      "--manifest-path",
      "apps/desktop/src-tauri/Cargo.toml",
      "--test",
      "commands",
      "--",
      "--nocapture",
    ]);
  });

  test("desktop Vue store and shell unit tests pass", () => {
    run("pnpm", ["--filter", "@synapse/desktop", "test"]);
  });

  test("desktop package typechecks", () => {
    run("pnpm", ["--filter", "@synapse/desktop", "typecheck"]);
  });
});
