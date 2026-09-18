import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const updater = "infra/scripts/update-instance.sh";

async function createFakeCommands(root) {
  const bin = join(root, "bin");
  const captures = join(root, "captures");
  await mkdir(bin);
  await mkdir(captures);

  const curl = join(bin, "curl");
  await writeFile(
    curl,
    `#!/usr/bin/env bash
set -euo pipefail
count_file="$SYNAPSE_TEST_CAPTURE_DIR/curl-count"
count=0
[[ -f "$count_file" ]] && count="$(<"$count_file")"
count=$((count + 1))
printf '%s' "$count" > "$count_file"
printf '%s\\n' "$@" > "$SYNAPSE_TEST_CAPTURE_DIR/curl-$count.args"

config=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "--config" ]]; then
    config="$argument"
    break
  fi
  previous="$argument"
done

if [[ "\${SYNAPSE_TEST_EXPECT_AUTH:-0}" == "1" ]]; then
  if [[ -n "$config" ]]; then
    [[ "$(stat -c '%a' "$config")" == "600" ]] || {
      echo "curl config permissions are not restrictive" >&2
      exit 91
    }
    expected_header='header = "Authorization: Bearer '"\${SYNAPSE_TEST_EXPECTED_TOKEN}"'"'
    grep -Fx -- "$expected_header" "$config" >/dev/null || {
      echo "curl config lacks the effective authorization header" >&2
      exit 92
    }
    printf '%s\\n' "$config" >> "$SYNAPSE_TEST_CAPTURE_DIR/curl-configs"
  else
    for argument in "$@"; do
      if [[ "$argument" == Authorization:* ]]; then
        echo "redacted authorization header received" >&2
        exit 93
      fi
    done
    echo "missing authorization configuration" >&2
    exit 94
  fi
else
  [[ -z "$config" ]] || { echo "public request unexpectedly used curl config" >&2; exit 95; }
  ! printf '%s\\n' "$@" | grep -Fq 'Authorization:' || {
    echo "public request unexpectedly sent authorization" >&2
    exit 96
  }
fi

output=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "--output" ]]; then
    output="$argument"
    break
  fi
  previous="$argument"
done

if [[ "$count" == "1" ]]; then
  printf '%s' '{"tag_name":"v0.1.1","assets":[{"name":"synapse-0.1.1.tar.gz","id":424242}],"target_commitish":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
else
  [[ -n "$output" ]] || { echo "archive download lacks an output file" >&2; exit 97; }
  printf '%s' 'archive' > "$output"
fi
`,
  );
  await chmod(curl, 0o755);

  const jq = join(bin, "jq");
  await writeFile(
    jq,
    `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *tag_name*) printf '%s\\n' 'v0.1.1' ;;
  *assets*) printf '%s\\n' '424242' ;;
  *target_commitish*) printf '%s\\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' ;;
  *) exit 1 ;;
esac
`,
  );
  await chmod(jq, 0o755);

  const deploy = join(bin, "deploy");
  await writeFile(
    deploy,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > "$SYNAPSE_TEST_CAPTURE_DIR/deploy.args"
`,
  );
  await chmod(deploy, 0o755);

  return { bin, captures, deploy };
}

async function runUpdater({ configure, token }) {
  const root = await mkdtemp(join(tmpdir(), "synapse-pull-updater-"));
  const { bin, captures, deploy } = await createFakeCommands(root);
  const environment = join(root, ".env");
  const tokenFile = join(root, ".update-token");
  await writeFile(environment, "SYNAPSE_ALLOWED_ORIGIN=https://synapse.example.test\n");
  if (token) await writeFile(tokenFile, `${token}\n`);

  const incoming = configure ? await configure(root) : undefined;

  let failure;
  let result;
  try {
    result = await execFileAsync("bash", [updater], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        SYNAPSE_DEPLOY_COMMAND: deploy,
        ...(incoming ? { SYNAPSE_DEPLOY_INCOMING: incoming } : {}),
        SYNAPSE_DEPLOY_ROOT: root,
        SYNAPSE_TEST_CAPTURE_DIR: captures,
        SYNAPSE_TEST_EXPECT_AUTH: token ? "1" : "0",
        SYNAPSE_TEST_EXPECTED_TOKEN: token ?? "",
        SYNAPSE_UPDATE_API: "https://api.example.test",
        SYNAPSE_UPDATE_ENV_FILE: environment,
        SYNAPSE_UPDATE_REPOSITORY: "synapse/example",
        SYNAPSE_UPDATE_TOKEN_FILE: tokenFile,
      },
    });
  } catch (error) {
    failure = error;
  }

  return { captures, failure, result, root, token };
}

test("curl parses a quoted Authorization curl-config directive without whitespace warning", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "synapse-curl-config-"));
  const config = join(root, "curl.config");
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(config, 'header = "Authorization: Bearer fixture-token"\n', {
    mode: 0o600,
  });

  const { stderr, stdout } = await execFileAsync("curl", [
    "--config",
    config,
    "--version",
  ]);

  assert.match(stdout, /^curl /u);
  assert.doesNotMatch(stderr, /uses unquoted whitespace/u);
});

test("pull updater authenticates both private GitHub downloads without exposing its token", async () => {
  const token = `ghp_${"x".repeat(36)}`;
  const { captures, result, root } = await runUpdater({ token });

  const [firstArgs, secondArgs, deployArgs, configs] = await Promise.all([
    readFile(join(captures, "curl-1.args"), "utf8"),
    readFile(join(captures, "curl-2.args"), "utf8"),
    readFile(join(captures, "deploy.args"), "utf8"),
    readFile(join(captures, "curl-configs"), "utf8"),
  ]);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.doesNotMatch(firstArgs, new RegExp(token, "u"));
  assert.doesNotMatch(secondArgs, new RegExp(token, "u"));
  assert.doesNotMatch(deployArgs, new RegExp(token, "u"));
  assert.match(secondArgs, /\/releases\/assets\/424242/u);
  assert.match(secondArgs, /application\/octet-stream/u);
  assert.equal(configs.trim().split("\n").length, 2);
  for (const config of configs.trim().split("\n")) {
    await assert.rejects(readFile(config, "utf8"));
  }
  assert.equal(await readFile(join(root, "incoming/synapse-0.1.1.tar.gz"), "utf8"), "archive");
});

test("the updater unit allows a full deployment to finish", async () => {
  const unit = await readFile(
    "infra/systemd/synapse-update.service",
    "utf8",
  );
  const timeout = unit.match(/TimeoutStartSec=(\S+)/u)?.[1];
  assert.ok(timeout, "synapse-update.service must set TimeoutStartSec");
  assert.ok(
    timeout === "infinity" || Number(timeout) >= 1800,
    `TimeoutStartSec must not interrupt a deployment, got ${timeout}`,
  );
});

test("pull updater accepts a fine-grained GitHub token", async () => {
  const token = `github_pat_${"a".repeat(30)}`;
  const { result } = await runUpdater({ token });

  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("pull updater keeps public GitHub downloads unauthenticated", async () => {
  const { captures, result, root } = await runUpdater({ token: undefined });

  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.doesNotMatch(
    await readFile(join(captures, "curl-1.args"), "utf8"),
    /Authorization:/u,
  );
  assert.doesNotMatch(
    await readFile(join(captures, "curl-2.args"), "utf8"),
    /Authorization:/u,
  );
  assert.equal(
    await readFile(join(root, "incoming/synapse-0.1.1.tar.gz"), "utf8"),
    "archive",
  );
});

test("pull updater rejects a symlinked incoming directory before network or deployment", async (t) => {
  let external;
  const { captures, failure, root } = await runUpdater({
    configure: async (deploymentRoot) => {
      external = await mkdtemp(join(tmpdir(), "synapse-external-incoming-"));
      await writeFile(join(external, "sentinel"), "do not modify\n");
      const incoming = join(deploymentRoot, "configured-incoming");
      await symlink(external, incoming);
      return incoming;
    },
    token: undefined,
  });
  t.after(() => Promise.all([rm(root, { force: true, recursive: true }), rm(external, { force: true, recursive: true })]));

  assert.ok(failure, "the updater must reject a symlinked incoming directory");
  assert.match(failure.stderr, /update incoming directory is unsafe/u);
  assert.deepEqual(await readdir(captures), []);
  assert.equal(await readFile(join(external, "sentinel"), "utf8"), "do not modify\n");
  assert.deepEqual(await readdir(external), ["sentinel"]);
});
