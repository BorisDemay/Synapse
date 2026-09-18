import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  link,
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const deployRelease = join(repositoryRoot, "infra/scripts/deploy-release.sh");
const nodeExecutable = process.execPath;
const version = "0.1.2";
const previousVersion = "0.1.1";
const commitSha = "a".repeat(40);

function manifestIdentity(releaseVersion) {
  return {
    commit_sha: commitSha,
    notes: "Hermetic release test",
    pub_date: "2026-09-12T12:00:00Z",
    version: releaseVersion,
  };
}

async function writeExecutable(path, content) {
  await writeFile(path, content);
  await chmod(path, 0o755);
}

async function createFakeCommands(root) {
  const bin = join(root, "bin");
  await mkdir(bin);

  await writeExecutable(
    join(bin, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$SYNAPSE_TEST_DOCKER_LOG"
if [[ "$1" == "load" ]]; then
  exit 0
fi
if [[ "$1" == "image" && "$2" == "inspect" ]]; then
  if [[ "$*" == *org.opencontainers.image.version* ]]; then
    printf '%s' "$SYNAPSE_TEST_VERSION"
  else
    printf '%s' "$SYNAPSE_TEST_COMMIT_SHA"
  fi
  exit 0
fi
if [[ "$1" == "compose" ]]; then
  if [[ "$*" == *" config --format json"* ]]; then
    printf '%s' '{"name":"synapse-test","volumes":{},"services":{"postgres":{"image":"postgres:16","volumes":[]},"server":{"image":"synapse-server:test","volumes":[]}}}'
  fi
  if [[ "$*" == *" up -d --no-build"* ]]; then
    while [[ "$1" != "-f" ]]; do
      shift
    done
    grep -E 'image: synapse-(server|web):' "$2" >> "$SYNAPSE_TEST_COMPOSE_LOG"
  fi
  exit 0
fi
printf 'unexpected docker invocation: %s\\n' "$*" >&2
exit 90
`,
  );

  await writeExecutable(
    join(bin, "curl"),
    `#!/usr/bin/env bash
set -euo pipefail
url="\${!#}"
if [[ -n "\${SYNAPSE_TEST_CURL_LOG:-}" ]]; then
  printf '%s\\n' "$url" >> "$SYNAPSE_TEST_CURL_LOG"
fi
if [[ "$url" == *"/health/version" || "$url" == *"/build.json" ]]; then
  if [[ "\${SYNAPSE_TEST_FAIL_HEALTH:-0}" == 1 ]]; then
    printf '%s' '{"version":"0.1.0","commit_sha":"stale"}'
  else
    printf '{"version":"%s","commit_sha":"%s"}' "$SYNAPSE_TEST_VERSION" "$SYNAPSE_TEST_COMMIT_SHA"
  fi
  exit 0
fi
if [[ "$url" == *"/updates/stable/latest.json" || "$url" == *"/updates/stable/web.json" ]]; then
  printf '{"version": "%s", "commit_sha": "%s", "pub_date": "2026-09-12T12:00:00Z", "notes": "test"}' \\
    "\${SYNAPSE_TEST_MANIFEST_VERSION:-$SYNAPSE_TEST_VERSION}" \\
    "\${SYNAPSE_TEST_MANIFEST_COMMIT_SHA:-$SYNAPSE_TEST_COMMIT_SHA}"
  exit 0
fi
`,
  );

  await writeExecutable(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");

  await writeExecutable(
    join(bin, "node"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$SYNAPSE_TEST_NODE_LOG"
exec "${nodeExecutable}" "$@"
`,
  );

  await writeExecutable(
    join(bin, "cp"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ -n "\${SYNAPSE_TEST_ADD_ARCHIVE_HARDLINK:-}" && ! -e "$SYNAPSE_TEST_HARDLINK_DONE" ]]; then
  ln -- "$SYNAPSE_TEST_ADD_ARCHIVE_HARDLINK" "$SYNAPSE_TEST_ARCHIVE_HARDLINK"
  : > "$SYNAPSE_TEST_HARDLINK_DONE"
fi
if [[ -n "\${SYNAPSE_TEST_REPLACE_ARCHIVE:-}" && ! -e "$SYNAPSE_TEST_REPLACEMENT_DONE" ]]; then
  rm -f -- "$SYNAPSE_TEST_REPLACE_ARCHIVE"
  ln -s "$SYNAPSE_TEST_SUBSTITUTE_ARCHIVE" "$SYNAPSE_TEST_REPLACE_ARCHIVE"
  : > "$SYNAPSE_TEST_REPLACEMENT_DONE"
fi
exec /usr/bin/cp "$@"
`,
  );

  await writeExecutable(
    join(bin, "tar"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$SYNAPSE_TEST_TAR_LOG"
if [[ -n "\${SYNAPSE_TEST_REPLACE_ARCHIVE:-}" && "$*" == *"$SYNAPSE_TEST_REPLACE_ARCHIVE"* && ! -e "$SYNAPSE_TEST_REPLACEMENT_DONE" ]]; then
  rm -f -- "$SYNAPSE_TEST_REPLACE_ARCHIVE"
  ln -s "$SYNAPSE_TEST_SUBSTITUTE_ARCHIVE" "$SYNAPSE_TEST_REPLACE_ARCHIVE"
  : > "$SYNAPSE_TEST_REPLACEMENT_DONE"
fi
exec /usr/bin/tar "$@"
`,
  );

  await writeExecutable(
    join(bin, "sha256sum"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$SYNAPSE_TEST_CHECKSUM_LOG"
exec /usr/bin/sha256sum "$@"
`,
  );

  await writeExecutable(
    join(bin, "readlink"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${SYNAPSE_TEST_FAIL_POST_ACTIVATION:-0}" == 1 && "$1" == "$SYNAPSE_TEST_RELEASES/current" && -L "$1" && "$(/usr/bin/readlink "$1")" == "$SYNAPSE_TEST_VERSION" ]]; then
  exit 97
fi
exec /usr/bin/readlink "$@"
`,
  );

  return bin;
}

async function createDeploymentRoot() {
  const root = await mkdtemp(join(tmpdir(), "synapse-deploy-release-"));
  const stage = join(root, "staging", `${version}-${commitSha}`);
  const releasesParent = join(root, "releases");
  const release = join(stage, "release", "stable");
  const releases = join(releasesParent, "stable");
  const bin = await createFakeCommands(root);

  await mkdir(join(root, "infra", "scripts"), { recursive: true });
  await cp(
    join(repositoryRoot, "infra/scripts/check-deployment-layout.py"),
    join(root, "infra", "scripts", "check-deployment-layout.py"),
  );
  await writeExecutable(
    join(root, "infra", "scripts", "backup.sh"),
    '#!/usr/bin/env bash\nprintf \'ENV_FILE=%s %s\\n\' "${ENV_FILE:-}" "$*" >> "$SYNAPSE_TEST_BACKUP_LOG"\n',
  );
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, "stage-sentinel"), "do not modify staging\n");
  await mkdir(join(release, version), { recursive: true });
  await mkdir(join(releases, previousVersion), { recursive: true });
  await symlink(previousVersion, join(releases, "current"));

  const compose = [
    "services:",
    "  server:",
    "    image: synapse-server:0.1.1",
    "  web:",
    "    image: synapse-web:0.1.1",
    "",
  ].join("\n");
  await writeFile(join(root, "docker-compose.yml"), compose);
  await writeFile(
    join(root, ".env"),
    "SYNAPSE_PUBLIC_URL=https://synapse.example.test\n",
  );
  await writeFile(join(root, ".active-version"), `${previousVersion}\n`);
  await writeFile(join(root, ".migration-checksums"), "migrations\n");
  await writeFile(join(stage, "migrations.sha256"), "migrations\n");
  const composeLog = join(root, "compose-invocations.log");
  const curlLog = join(root, "curl-invocations.log");
  const dockerLog = join(root, "docker-invocations.log");
  const backupLog = join(root, "backup-invocations.log");
  const checksumLog = join(root, "checksum-invocations.log");
  const nodeLog = join(root, "node-invocations.log");
  const tarLog = join(root, "tar-invocations.log");
  const validatorExecutionLog = join(root, "validator-execution.log");
  await writeFile(composeLog, "");
  await writeFile(curlLog, "");
  await writeFile(dockerLog, "");
  await writeFile(backupLog, "");
  await writeFile(checksumLog, "");
  await writeFile(nodeLog, "");
  await writeFile(tarLog, "");
  await writeFile(validatorExecutionLog, "");
  await writeFile(
    join(stage, `synapse-server-${version}.tar`),
    "server image\n",
  );
  await writeFile(join(stage, `synapse-web-${version}.tar`), "web image\n");
  await cp(
    join(repositoryRoot, "infra/scripts/release/validate-release.mjs"),
    join(stage, "validate-release.mjs"),
  );

  for (const artifact of [
    "synapse-linux-x86_64.AppImage",
    "synapse-windows-x86_64.exe",
  ]) {
    await writeFile(join(release, version, artifact), `${artifact}\n`);
  }
  const identity = manifestIdentity(version);
  await writeFile(
    join(release, "latest.json"),
    `${JSON.stringify({
      ...identity,
      platforms: {
        "linux-x86_64": {
          signature: "linux-signature",
          url: `https://synapse.example.test/updates/stable/${version}/synapse-linux-x86_64.AppImage`,
        },
        "windows-x86_64": {
          signature: "windows-signature",
          url: `https://synapse.example.test/updates/stable/${version}/synapse-windows-x86_64.exe`,
        },
      },
    })}\n`,
  );
  await writeFile(join(release, "web.json"), `${JSON.stringify(identity)}\n`);

  const checksummed = [
    "migrations.sha256",
    `synapse-server-${version}.tar`,
    `synapse-web-${version}.tar`,
    "validate-release.mjs",
  ];
  const sums = await Promise.all(
    checksummed.map(async (name) => {
      const contents = await readFile(join(stage, name));
      return `${createHash("sha256").update(contents).digest("hex")}  ${name}`;
    }),
  );
  await writeFile(join(stage, "SHA256SUMS"), `${sums.join("\n")}\n`);

  return {
    backupLog,
    bin,
    checksumLog,
    compose,
    composeLog,
    curlLog,
    dockerLog,
    nodeLog,
    releases,
    releasesParent,
    root,
    stage,
    tarLog,
    validatorExecutionLog,
  };
}

async function runDeployment(options = {}) {
  const fixture = await createDeploymentRoot();
  if (options.symlinkedDeploymentRoot) {
    const externalDeploymentRoot = await mkdtemp(
      join(tmpdir(), "synapse-external-deploy-root-"),
    );
    await rm(externalDeploymentRoot, { force: true, recursive: true });
    await rename(fixture.root, externalDeploymentRoot);
    await writeFile(
      join(externalDeploymentRoot, "deployment-root-sentinel"),
      "do not modify external deployment root\n",
    );
    await symlink(externalDeploymentRoot, fixture.root);
    fixture.externalDeploymentRoot = externalDeploymentRoot;
  }
  if (options.symlinkedStagingParent) {
    const externalStaging = await mkdtemp(
      join(tmpdir(), "synapse-external-staging-"),
    );
    const incoming = join(fixture.root, "incoming");
    await writeFile(
      join(externalStaging, "sentinel"),
      "do not modify external staging\n",
    );
    await rm(join(fixture.root, "staging"), { force: true, recursive: true });
    await mkdir(incoming);
    await execFileAsync("tar", [
      "-czf",
      join(incoming, `synapse-${version}.tar.gz`),
      "-T",
      "/dev/null",
    ]);
    await symlink(externalStaging, join(fixture.root, "staging"));
    fixture.externalStaging = externalStaging;
  }
  if (options.symlinkedIncomingParent) {
    const externalIncoming = await mkdtemp(
      join(tmpdir(), "synapse-external-incoming-"),
    );
    const archive = join(externalIncoming, `synapse-${version}.tar.gz`);
    await writeFile(
      join(externalIncoming, "sentinel"),
      "do not modify external incoming\n",
    );
    await rm(fixture.stage, { force: true, recursive: true });
    await execFileAsync("tar", ["-czf", archive, "-T", "/dev/null"]);
    await symlink(externalIncoming, join(fixture.root, "incoming"));
    fixture.externalIncoming = externalIncoming;
    fixture.incomingArchive = archive;
  }
  if (options.symlinkedIncomingArchive) {
    const externalIncomingArchive = await mkdtemp(
      join(tmpdir(), "synapse-external-incoming-archive-"),
    );
    const archive = join(externalIncomingArchive, `synapse-${version}.tar.gz`);
    const incoming = join(fixture.root, "incoming");
    await writeFile(
      join(externalIncomingArchive, "sentinel"),
      "do not modify external incoming archive\n",
    );
    await rm(fixture.stage, { force: true, recursive: true });
    await mkdir(incoming);
    await execFileAsync("tar", ["-czf", archive, "-T", "/dev/null"]);
    await symlink(archive, join(incoming, `synapse-${version}.tar.gz`));
    fixture.externalIncomingArchive = externalIncomingArchive;
    fixture.incomingArchive = archive;
  }
  if (options.symlinkedConfiguredIncomingArchive) {
    const configuredIncoming = await mkdtemp(
      join(tmpdir(), "synapse-configured-incoming-"),
    );
    const externalIncomingArchive = await mkdtemp(
      join(tmpdir(), "synapse-external-configured-incoming-archive-"),
    );
    const archive = join(externalIncomingArchive, `synapse-${version}.tar.gz`);
    await writeFile(
      join(externalIncomingArchive, "sentinel"),
      "do not modify external configured incoming archive\n",
    );
    await rm(fixture.stage, { force: true, recursive: true });
    await execFileAsync("tar", ["-czf", archive, "-T", "/dev/null"]);
    await symlink(
      archive,
      join(configuredIncoming, `synapse-${version}.tar.gz`),
    );
    fixture.configuredIncoming = configuredIncoming;
    fixture.externalIncomingArchive = externalIncomingArchive;
    fixture.incomingArchive = archive;
  }
  if (options.symlinkedConfiguredIncomingDirectory) {
    const configuredIncoming = await mkdtemp(
      join(tmpdir(), "synapse-configured-incoming-"),
    );
    const externalIncoming = await mkdtemp(
      join(tmpdir(), "synapse-external-configured-incoming-"),
    );
    const archive = join(externalIncoming, `synapse-${version}.tar.gz`);
    await writeFile(
      join(externalIncoming, "sentinel"),
      "do not modify external configured incoming\n",
    );
    await rm(fixture.stage, { force: true, recursive: true });
    await execFileAsync("tar", ["-czf", archive, "-T", "/dev/null"]);
    await rm(configuredIncoming, { force: true, recursive: true });
    await symlink(externalIncoming, configuredIncoming);
    fixture.configuredIncoming = configuredIncoming;
    fixture.externalConfiguredIncoming = externalIncoming;
    fixture.incomingArchive = archive;
  }
  if (options.symlinkedStagedChecksumManifest) {
    const archiveSource = join(fixture.root, "archive-source");
    const externalChecksumManifest = await mkdtemp(
      join(tmpdir(), "synapse-external-checksum-manifest-"),
    );
    const incoming = join(fixture.root, "incoming");
    const archive = join(incoming, `synapse-${version}.tar.gz`);

    await writeFile(
      join(externalChecksumManifest, "sentinel"),
      "do not modify external checksum manifest\n",
    );
    await rename(fixture.stage, archiveSource);
    await rename(
      join(archiveSource, "SHA256SUMS"),
      join(externalChecksumManifest, "SHA256SUMS"),
    );
    await symlink(
      join(externalChecksumManifest, "SHA256SUMS"),
      join(archiveSource, "SHA256SUMS"),
    );
    await mkdir(incoming);
    await execFileAsync("tar", ["-czf", archive, "-C", archiveSource, "."]);
    fixture.archiveSource = archiveSource;
    fixture.externalChecksumManifest = externalChecksumManifest;
    fixture.incomingArchive = archive;
  }
  if (options.symlinkedStagedValidator) {
    const archiveSource = join(fixture.root, "archive-source");
    const externalValidator = await mkdtemp(
      join(tmpdir(), "synapse-external-staged-validator-"),
    );
    const incoming = join(fixture.root, "incoming");
    const archive = join(incoming, `synapse-${version}.tar.gz`);

    await writeFile(
      join(externalValidator, "sentinel"),
      "do not modify external staged validator\n",
    );
    await rename(fixture.stage, archiveSource);
    await rename(
      join(archiveSource, "validate-release.mjs"),
      join(externalValidator, "validate-release-target.mjs"),
    );
    await writeFile(
      join(externalValidator, "validate-release.mjs"),
      [
        'import { appendFile } from "node:fs/promises";',
        "",
        'await appendFile(process.env.SYNAPSE_TEST_VALIDATOR_EXECUTION_LOG, "executed\\n");',
        'await import("./validate-release-target.mjs");',
        "",
      ].join("\n"),
    );
    await symlink(
      join(externalValidator, "validate-release.mjs"),
      join(archiveSource, "validate-release.mjs"),
    );
    const sums = await Promise.all(
      [
        "migrations.sha256",
        `synapse-server-${version}.tar`,
        `synapse-web-${version}.tar`,
        "validate-release.mjs",
      ].map(async (name) => {
        const contents = await readFile(join(archiveSource, name));
        return `${createHash("sha256").update(contents).digest("hex")}  ${name}`;
      }),
    );
    await writeFile(join(archiveSource, "SHA256SUMS"), `${sums.join("\n")}\n`);
    await mkdir(incoming);
    await execFileAsync("tar", ["-czf", archive, "-C", archiveSource, "."]);
    fixture.archiveSource = archiveSource;
    fixture.externalValidator = externalValidator;
    fixture.incomingArchive = archive;
  }
  if (options.symlinkedStagedMigrationsChecksum) {
    const archiveSource = join(fixture.root, "archive-source");
    const externalMigrationsChecksum = await mkdtemp(
      join(tmpdir(), "synapse-external-migrations-checksum-"),
    );
    const incoming = join(fixture.root, "incoming");
    const archive = join(incoming, `synapse-${version}.tar.gz`);

    await writeFile(
      join(externalMigrationsChecksum, "sentinel"),
      "do not modify external migrations checksum\n",
    );
    await rename(fixture.stage, archiveSource);
    await rename(
      join(archiveSource, "migrations.sha256"),
      join(externalMigrationsChecksum, "migrations.sha256"),
    );
    await symlink(
      join(externalMigrationsChecksum, "migrations.sha256"),
      join(archiveSource, "migrations.sha256"),
    );
    const sums = await Promise.all(
      [
        "migrations.sha256",
        `synapse-server-${version}.tar`,
        `synapse-web-${version}.tar`,
        "validate-release.mjs",
      ].map(async (name) => {
        const contents = await readFile(join(archiveSource, name));
        return `${createHash("sha256").update(contents).digest("hex")}  ${name}`;
      }),
    );
    await writeFile(join(archiveSource, "SHA256SUMS"), `${sums.join("\n")}\n`);
    await mkdir(incoming);
    await execFileAsync("tar", ["-czf", archive, "-C", archiveSource, "."]);
    fixture.archiveSource = archiveSource;
    fixture.externalMigrationsChecksum = externalMigrationsChecksum;
    fixture.incomingArchive = archive;
  }
  if (options.symlinkedStagedRelease) {
    const archiveSource = join(fixture.root, "archive-source");
    const externalRelease = await mkdtemp(
      join(tmpdir(), "synapse-external-staged-release-"),
    );
    const incoming = join(fixture.root, "incoming");
    const archive = join(incoming, `synapse-${version}.tar.gz`);

    await rename(fixture.stage, archiveSource);
    await rename(
      join(archiveSource, "release"),
      join(externalRelease, "release"),
    );
    await writeFile(
      join(externalRelease, "release", "sentinel"),
      "do not modify external staged release\n",
    );
    await symlink(
      join(externalRelease, "release"),
      join(archiveSource, "release"),
    );
    await mkdir(incoming);
    await execFileAsync("tar", ["-czf", archive, "-C", archiveSource, "."]);
    fixture.archiveSource = archiveSource;
    fixture.externalRelease = externalRelease;
    fixture.incomingArchive = archive;
  }
  if (options.symlinkedStagedReleaseContent) {
    const archiveSource = join(fixture.root, "archive-source");
    const externalReleaseContent = await mkdtemp(
      join(tmpdir(), "synapse-external-staged-release-content-"),
    );
    const incoming = join(fixture.root, "incoming");
    const archive = join(incoming, `synapse-${version}.tar.gz`);
    const stagedLatestManifest = join(
      archiveSource,
      "release",
      "stable",
      "latest.json",
    );
    const externalLatestManifest = join(externalReleaseContent, "latest.json");

    await rename(fixture.stage, archiveSource);
    await rename(stagedLatestManifest, externalLatestManifest);
    await writeFile(
      join(externalReleaseContent, "sentinel"),
      "do not modify external staged release content\n",
    );
    await symlink(externalLatestManifest, stagedLatestManifest);
    await mkdir(incoming);
    await execFileAsync("tar", ["-czf", archive, "-C", archiveSource, "."]);
    fixture.archiveSource = archiveSource;
    fixture.externalReleaseContent = externalReleaseContent;
    fixture.incomingArchive = archive;
  }
  if (options.linkedArchiveEntries) {
    const archiveSource = join(fixture.root, "archive-source");
    const incoming = join(fixture.root, "incoming");
    const archive = join(incoming, `synapse-${version}.tar.gz`);
    const linkedFile = join(archiveSource, "linked-file");

    await rename(fixture.stage, archiveSource);
    await writeFile(linkedFile, "linked archive content\n");
    await symlink(linkedFile, join(archiveSource, "linked-symlink"));
    await link(linkedFile, join(archiveSource, "linked-hardlink"));
    await mkdir(incoming);
    await execFileAsync("tar", ["-czf", archive, "-C", archiveSource, "."]);
    fixture.archiveSource = archiveSource;
    fixture.incomingArchive = archive;
  }
  if (options.fifoArchiveEntry) {
    const archiveSource = join(fixture.root, "archive-source");
    const incoming = join(fixture.root, "incoming");
    const archive = join(incoming, `synapse-${version}.tar.gz`);

    await rename(fixture.stage, archiveSource);
    await execFileAsync("mkfifo", [join(archiveSource, "release-fifo")]);
    await mkdir(incoming);
    await execFileAsync("tar", ["-czf", archive, "-C", archiveSource, "."]);
    fixture.archiveSource = archiveSource;
    fixture.incomingArchive = archive;
  }
  if (options.archiveReplacementBeforeCapture) {
    const archiveSource = join(fixture.root, "archive-source");
    const substituteSource = join(fixture.root, "substitute-source");
    const incoming = join(fixture.root, "incoming");
    const archive = join(incoming, `synapse-${version}.tar.gz`);
    const substituteArchive = join(
      fixture.root,
      `substitute-${version}.tar.gz`,
    );

    await rename(fixture.stage, archiveSource);
    await cp(archiveSource, substituteSource, { recursive: true });
    await writeFile(
      join(
        substituteSource,
        "release",
        "stable",
        version,
        "synapse-linux-x86_64.AppImage",
      ),
      "substituted release artifact\n",
    );
    await mkdir(incoming);
    await execFileAsync("tar", ["-czf", archive, "-C", archiveSource, "."]);
    await execFileAsync("tar", [
      "-czf",
      substituteArchive,
      "-C",
      substituteSource,
      ".",
    ]);
    fixture.incomingArchive = archive;
    fixture.substituteArchive = substituteArchive;
    fixture.replacementDone = join(fixture.root, "archive-replacement.done");
  }
  if (options.archiveHardlinkAddedDuringCapture) {
    const archiveSource = join(fixture.root, "archive-source");
    const incoming = join(fixture.root, "incoming");
    const archive = join(incoming, `synapse-${version}.tar.gz`);

    await rename(fixture.stage, archiveSource);
    await mkdir(incoming);
    await execFileAsync("tar", ["-czf", archive, "-C", archiveSource, "."]);
    fixture.archiveHardlink = join(incoming, "archive-hardlink");
    fixture.hardlinkDone = join(fixture.root, "archive-hardlink.done");
    fixture.incomingArchive = archive;
  }
  if (options.symlinkedStagedDeploymentCompose) {
    const externalDeploymentCompose = await mkdtemp(
      join(tmpdir(), "synapse-external-staged-deployment-compose-"),
    );
    const stagedDeploymentCompose = join(
      fixture.stage,
      "docker-compose.deploy.yml",
    );

    await writeFile(
      join(externalDeploymentCompose, "docker-compose.deploy.yml"),
      "do not modify external deployment compose\n",
    );
    await symlink(
      join(externalDeploymentCompose, "docker-compose.deploy.yml"),
      stagedDeploymentCompose,
    );
    fixture.externalDeploymentCompose = externalDeploymentCompose;
  }
  if (options.symlinkedStagedServerImageArchive) {
    const externalServerImageArchive = await mkdtemp(
      join(tmpdir(), "synapse-external-staged-server-image-archive-"),
    );
    const stagedServerImageArchive = join(
      fixture.stage,
      `synapse-server-${version}.tar`,
    );
    const externalArchive = join(
      externalServerImageArchive,
      `synapse-server-${version}.tar`,
    );

    await rename(stagedServerImageArchive, externalArchive);
    await symlink(externalArchive, stagedServerImageArchive);
    fixture.externalServerImageArchive = externalServerImageArchive;
  }
  if (options.symlinkedStagedWebImageArchive) {
    const externalWebImageArchive = await mkdtemp(
      join(tmpdir(), "synapse-external-staged-web-image-archive-"),
    );
    const stagedWebImageArchive = join(
      fixture.stage,
      `synapse-web-${version}.tar`,
    );
    const externalArchive = join(
      externalWebImageArchive,
      `synapse-web-${version}.tar`,
    );

    await rename(stagedWebImageArchive, externalArchive);
    await symlink(externalArchive, stagedWebImageArchive);
    fixture.externalWebImageArchive = externalWebImageArchive;
  }
  if (options.symlinkedReleasesParent) {
    const externalReleasesParent = join(fixture.root, "external-releases");
    await rm(fixture.releasesParent, { force: true, recursive: true });
    await mkdir(join(externalReleasesParent, "stable", previousVersion), {
      recursive: true,
    });
    await symlink(
      previousVersion,
      join(externalReleasesParent, "stable", "current"),
    );
    await writeFile(
      join(externalReleasesParent, "sentinel"),
      "do not modify\n",
    );
    await symlink(externalReleasesParent, fixture.releasesParent);
    fixture.externalReleasesParent = externalReleasesParent;
  }
  if (options.symlinkedStableReleasesDirectory) {
    const externalReleases = join(fixture.root, "external-stable-releases");
    await rm(fixture.releases, { force: true, recursive: true });
    await mkdir(join(externalReleases, previousVersion), { recursive: true });
    await symlink(previousVersion, join(externalReleases, "current"));
    await writeFile(join(externalReleases, "sentinel"), "do not modify\n");
    await symlink(externalReleases, fixture.releases);
    fixture.externalReleases = externalReleases;
  }
  if (options.staleRollbackPointer) {
    await writeFile(
      join(fixture.releases, "current.rollback"),
      "interrupted rollback\n",
    );
  }
  if (options.staleRollbackDirectory) {
    await mkdir(join(fixture.releases, "current.rollback"));
  }
  if (options.staleActivationPointer) {
    await symlink(previousVersion, join(fixture.releases, "current.next"));
  }
  if (options.staleActivationDirectory) {
    await mkdir(join(fixture.releases, "current.next"));
  }
  if (options.symlinkedStableRelease) {
    const externalRelease = join(fixture.root, "external-stable-release");
    await mkdir(externalRelease);
    await symlink(externalRelease, join(fixture.releases, version));
    fixture.externalRelease = externalRelease;
  }
  if (options.existingStableRelease) {
    const stableRelease = join(fixture.releases, version);
    await mkdir(stableRelease);
    await writeFile(join(stableRelease, "sentinel"), "do not modify\n");
  }
  if (options.changedMigrations) {
    await writeFile(
      join(fixture.root, ".migration-checksums"),
      "stale-migrations\n",
    );
  }
  const result = await execFileAsync(
    "bash",
    [deployRelease, version, commitSha],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: `${fixture.bin}:${process.env.PATH}`,
        SYNAPSE_DEPLOY_ROOT: fixture.root,
        SYNAPSE_DEPLOY_INCOMING: fixture.configuredIncoming,
        SYNAPSE_TEST_COMMIT_SHA: commitSha,
        SYNAPSE_TEST_BACKUP_LOG: fixture.backupLog,
        SYNAPSE_TEST_ADD_ARCHIVE_HARDLINK:
          options.archiveHardlinkAddedDuringCapture
            ? fixture.incomingArchive
            : "",
        SYNAPSE_TEST_ARCHIVE_HARDLINK: fixture.archiveHardlink,
        SYNAPSE_TEST_CHECKSUM_LOG: fixture.checksumLog,
        SYNAPSE_TEST_COMPOSE_LOG: fixture.composeLog,
        SYNAPSE_TEST_CURL_LOG: fixture.curlLog,
        SYNAPSE_TEST_DOCKER_LOG: fixture.dockerLog,
        SYNAPSE_TEST_FAIL_HEALTH: options.failHealth ? "1" : "0",
        SYNAPSE_TEST_FAIL_POST_ACTIVATION: options.failPostActivation
          ? "1"
          : "0",
        SYNAPSE_TEST_HARDLINK_DONE: fixture.hardlinkDone,
        SYNAPSE_TEST_MANIFEST_VERSION: options.manifestVersion ?? version,
        SYNAPSE_TEST_MANIFEST_COMMIT_SHA:
          options.manifestCommitSha ?? commitSha,
        SYNAPSE_TEST_RELEASES: fixture.releases,
        SYNAPSE_TEST_REPLACEMENT_DONE: fixture.replacementDone,
        SYNAPSE_TEST_REPLACE_ARCHIVE: options.archiveReplacementBeforeCapture
          ? fixture.incomingArchive
          : "",
        SYNAPSE_TEST_SUBSTITUTE_ARCHIVE: fixture.substituteArchive,
        SYNAPSE_TEST_TAR_LOG: fixture.tarLog,
        SYNAPSE_TEST_VERSION: version,
        SYNAPSE_TEST_NODE_LOG: fixture.nodeLog,
        SYNAPSE_TEST_VALIDATOR_EXECUTION_LOG: fixture.validatorExecutionLog,
      },
    },
  ).then(
    () => ({ code: 0 }),
    (error) => ({ code: error.code, stderr: error.stderr }),
  );

  return { ...fixture, ...result };
}

async function assertPreviousReleaseRestored(fixture) {
  assert.equal(
    await readlink(join(fixture.releases, "current")),
    previousVersion,
  );
  assert.equal(
    await readFile(join(fixture.root, ".active-version"), "utf8"),
    `${previousVersion}\n`,
  );
}

test("deploy release backs up with the deployment environment file", async (t) => {
  const fixture = await runDeployment({ changedMigrations: true });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  assert.equal(fixture.code, 0);
  const log = await readFile(fixture.backupLog, "utf8");
  assert.match(log, /^ENV_FILE=/u);
  assert.ok(
    log.includes(`ENV_FILE=${fixture.root}/.env `),
    `backup must receive the deployment environment file, got: ${log.trim()}`,
  );
});

test("deploy release activates both stable manifests through one version pointer after its gates", async (t) => {
  const fixture = await runDeployment();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  assert.equal(fixture.code, 0);
  assert.equal(await readlink(join(fixture.releases, "current")), version);
  assert.equal(
    await readFile(join(fixture.root, ".active-version"), "utf8"),
    `${version}\n`,
  );
  for (const manifest of ["latest.json", "web.json"]) {
    const manifestPath = join(fixture.releases, version, manifest);
    const identity = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(identity.version, version);
    assert.equal(identity.commit_sha, commitSha);
  }
});

test("deploy release verifies served stable manifests expose the deployed identity", async (t) => {
  const fixture = await runDeployment();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  assert.equal(fixture.code, 0);
  const requested = (await readFile(fixture.curlLog, "utf8"))
    .trim()
    .split("\n");
  assert.ok(requested.some((url) => url.endsWith("/health/version")));
  assert.ok(requested.some((url) => url.endsWith("/build.json")));
  assert.ok(
    requested.some((url) => url.endsWith("/updates/stable/latest.json")),
  );
  assert.ok(requested.some((url) => url.endsWith("/updates/stable/web.json")));
});

test("deploy release rolls back when a served manifest identity diverges", async (t) => {
  const fixture = await runDeployment({ manifestVersion: previousVersion });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  assert.notEqual(fixture.code, 0);
  assert.match(fixture.stderr, /does not expose the deployed identity/u);
  await assertPreviousReleaseRestored(fixture);
});

test("deploy release rejects archive replacement before capture", async (t) => {
  const fixture = await runDeployment({
    archiveReplacementBeforeCapture: true,
  });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  assert.equal((await lstat(fixture.incomingArchive)).isSymbolicLink(), true);
  assert.equal((await lstat(fixture.replacementDone)).isFile(), true);
  assert.notEqual(fixture.code, 0);
  await assertPreviousReleaseRestored(fixture);
  await assert.rejects(lstat(fixture.stage));
  await assert.rejects(lstat(join(fixture.releases, version)));
  assert.equal(await readFile(fixture.checksumLog, "utf8"), "");
  assert.equal(await readFile(fixture.nodeLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  assert.deepEqual(await readdir(join(fixture.root, "staging")), []);
});

test("deploy release rejects a hardlink added during capture", async (t) => {
  const fixture = await runDeployment({
    archiveHardlinkAddedDuringCapture: true,
  });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  assert.equal((await lstat(fixture.hardlinkDone)).isFile(), true);
  assert.equal((await lstat(fixture.incomingArchive)).nlink, 2);
  assert.equal((await lstat(fixture.archiveHardlink)).nlink, 2);
  assert.notEqual(fixture.code, 0);
  assert.match(fixture.stderr, /release archive changed during capture/);
  await assertPreviousReleaseRestored(fixture);
  await assert.rejects(lstat(fixture.stage));
  await assert.rejects(lstat(join(fixture.releases, version)));
  assert.equal(await readFile(fixture.tarLog, "utf8"), "");
  assert.equal(await readFile(fixture.checksumLog, "utf8"), "");
  assert.equal(await readFile(fixture.nodeLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  assert.deepEqual(await readdir(join(fixture.root, "staging")), []);
});

test("deploy release replaces a stale activation pointer before publishing the new version", async (t) => {
  const fixture = await runDeployment({ staleActivationPointer: true });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  assert.equal(fixture.code, 0, fixture.stderr);
  assert.equal(await readlink(join(fixture.releases, "current")), version);
});

test("deploy release refuses a stale activation directory without removing it", async (t) => {
  const fixture = await runDeployment({ staleActivationDirectory: true });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  assert.notEqual(fixture.code, 0);
  assert.match(fixture.stderr, /unexpected activation pointer/);
  assert.equal(
    (await lstat(join(fixture.releases, "current.next"))).isDirectory(),
    true,
  );
});

test("deploy release refuses a symlinked stable release without following it", async (t) => {
  const fixture = await runDeployment({ symlinkedStableRelease: true });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  const stableRelease = join(fixture.releases, version);
  assert.notEqual(fixture.code, 0);
  assert.match(fixture.stderr, /stable release path must not be a symlink/);
  assert.equal((await lstat(stableRelease)).isSymbolicLink(), true);
  assert.equal(await readlink(stableRelease), fixture.externalRelease);
  await assertPreviousReleaseRestored(fixture);
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
});

test("deploy release refuses a symlinked stable releases directory before staging", async (t) => {
  const fixture = await runDeployment({
    symlinkedStableReleasesDirectory: true,
  });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  const stageCompose = join(fixture.stage, "docker-compose.deploy.yml");

  assert.notEqual(fixture.code, 0);
  assert.match(
    fixture.stderr,
    /stable releases directory must not be a symlink/,
  );
  assert.equal((await lstat(fixture.releases)).isSymbolicLink(), true);
  assert.equal(await readlink(fixture.releases), fixture.externalReleases);
  assert.equal(
    await readFile(join(fixture.externalReleases, "sentinel"), "utf8"),
    "do not modify\n",
  );
  await assertPreviousReleaseRestored(fixture);
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  assert.equal(
    await readFile(join(fixture.stage, "stage-sentinel"), "utf8"),
    "do not modify staging\n",
  );
  await assert.rejects(readFile(stageCompose));
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses a symlinked releases parent before staging", async (t) => {
  const fixture = await runDeployment({ symlinkedReleasesParent: true });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  const stageCompose = join(fixture.stage, "docker-compose.deploy.yml");

  assert.notEqual(fixture.code, 0);
  assert.match(
    fixture.stderr,
    /releases parent directory must not be a symlink/,
  );
  assert.equal((await lstat(fixture.releasesParent)).isSymbolicLink(), true);
  assert.equal(
    await readlink(fixture.releasesParent),
    fixture.externalReleasesParent,
  );
  assert.equal(
    await readFile(join(fixture.externalReleasesParent, "sentinel"), "utf8"),
    "do not modify\n",
  );
  await assertPreviousReleaseRestored(fixture);
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  assert.equal(
    await readFile(join(fixture.stage, "stage-sentinel"), "utf8"),
    "do not modify staging\n",
  );
  await assert.rejects(readFile(stageCompose));
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses a symlinked deployment root before staging", async (t) => {
  const fixture = await runDeployment({ symlinkedDeploymentRoot: true });
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true });
    await rm(fixture.externalDeploymentRoot, { force: true, recursive: true });
  });

  const externalReleases = join(
    fixture.externalDeploymentRoot,
    "releases",
    "stable",
  );
  const stageCompose = join(fixture.stage, "docker-compose.deploy.yml");

  assert.notEqual(fixture.code, 0);
  assert.match(fixture.stderr, /deployment root must not be a symlink/);
  assert.equal((await lstat(fixture.root)).isSymbolicLink(), true);
  assert.equal(await readlink(fixture.root), fixture.externalDeploymentRoot);
  assert.equal(
    await readFile(
      join(fixture.externalDeploymentRoot, "deployment-root-sentinel"),
      "utf8",
    ),
    "do not modify external deployment root\n",
  );
  assert.equal(
    await readlink(join(externalReleases, "current")),
    previousVersion,
  );
  assert.equal(
    await readFile(
      join(fixture.externalDeploymentRoot, ".active-version"),
      "utf8",
    ),
    `${previousVersion}\n`,
  );
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  assert.equal(
    await readFile(join(fixture.stage, "stage-sentinel"), "utf8"),
    "do not modify staging\n",
  );
  await assert.rejects(readFile(stageCompose));
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses a symlinked staging parent before extraction", async (t) => {
  const fixture = await runDeployment({ symlinkedStagingParent: true });
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true });
    await rm(fixture.externalStaging, { force: true, recursive: true });
  });

  const externalStage = join(
    fixture.externalStaging,
    `${version}-${commitSha}`,
  );
  const stageCompose = join(externalStage, "docker-compose.deploy.yml");

  assert.notEqual(fixture.code, 0);
  assert.match(
    fixture.stderr,
    /staging parent directory must not be a symlink/,
  );
  assert.equal(
    (await lstat(join(fixture.root, "staging"))).isSymbolicLink(),
    true,
  );
  assert.equal(
    await readlink(join(fixture.root, "staging")),
    fixture.externalStaging,
  );
  assert.equal(
    await readFile(join(fixture.externalStaging, "sentinel"), "utf8"),
    "do not modify external staging\n",
  );
  await assert.rejects(lstat(externalStage));
  await assertPreviousReleaseRestored(fixture);
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  await assert.rejects(readFile(stageCompose));
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses a symlinked incoming parent before archive validation", async (t) => {
  const fixture = await runDeployment({ symlinkedIncomingParent: true });
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true });
    await rm(fixture.externalIncoming, { force: true, recursive: true });
  });

  const incoming = join(fixture.root, "incoming");
  const stageCompose = join(fixture.stage, "docker-compose.deploy.yml");

  assert.notEqual(fixture.code, 0);
  assert.match(
    fixture.stderr,
    /incoming parent directory must not be a symlink/,
  );
  assert.equal((await lstat(incoming)).isSymbolicLink(), true);
  assert.equal(await readlink(incoming), fixture.externalIncoming);
  assert.equal(
    await readFile(join(fixture.externalIncoming, "sentinel"), "utf8"),
    "do not modify external incoming\n",
  );
  assert.equal((await lstat(fixture.incomingArchive)).isFile(), true);
  await assert.rejects(lstat(fixture.stage));
  await assertPreviousReleaseRestored(fixture);
  assert.equal(await readFile(fixture.tarLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  await assert.rejects(readFile(stageCompose));
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses a symlinked default incoming archive before archive validation", async (t) => {
  const fixture = await runDeployment({ symlinkedIncomingArchive: true });
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true });
    await rm(fixture.externalIncomingArchive, { force: true, recursive: true });
  });

  const incomingArchive = join(
    fixture.root,
    "incoming",
    `synapse-${version}.tar.gz`,
  );
  const stageCompose = join(fixture.stage, "docker-compose.deploy.yml");

  assert.notEqual(fixture.code, 0);
  assert.match(
    fixture.stderr,
    /default incoming archive must not be a symlink/,
  );
  assert.equal((await lstat(incomingArchive)).isSymbolicLink(), true);
  assert.equal(await readlink(incomingArchive), fixture.incomingArchive);
  assert.equal(
    await readFile(join(fixture.externalIncomingArchive, "sentinel"), "utf8"),
    "do not modify external incoming archive\n",
  );
  assert.equal((await lstat(fixture.incomingArchive)).isFile(), true);
  await assert.rejects(lstat(fixture.stage));
  await assertPreviousReleaseRestored(fixture);
  assert.equal(await readFile(fixture.tarLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  await assert.rejects(readFile(stageCompose));
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses a symlinked configured incoming archive before archive validation", async (t) => {
  const fixture = await runDeployment({
    symlinkedConfiguredIncomingArchive: true,
  });
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true });
    await rm(fixture.configuredIncoming, { force: true, recursive: true });
    await rm(fixture.externalIncomingArchive, { force: true, recursive: true });
  });

  const incomingArchive = join(
    fixture.configuredIncoming,
    `synapse-${version}.tar.gz`,
  );
  const stageCompose = join(fixture.stage, "docker-compose.deploy.yml");

  assert.notEqual(fixture.code, 0);
  assert.match(
    fixture.stderr,
    /configured incoming archive must not be a symlink/,
  );
  assert.equal((await lstat(incomingArchive)).isSymbolicLink(), true);
  assert.equal(await readlink(incomingArchive), fixture.incomingArchive);
  assert.equal(
    await readFile(join(fixture.externalIncomingArchive, "sentinel"), "utf8"),
    "do not modify external configured incoming archive\n",
  );
  assert.equal((await lstat(fixture.incomingArchive)).isFile(), true);
  await assert.rejects(lstat(fixture.stage));
  await assertPreviousReleaseRestored(fixture);
  assert.equal(await readFile(fixture.tarLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  await assert.rejects(readFile(stageCompose));
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses a symlinked configured incoming directory before archive validation", async (t) => {
  const fixture = await runDeployment({
    symlinkedConfiguredIncomingDirectory: true,
  });
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true });
    await rm(fixture.configuredIncoming, { force: true });
    await rm(fixture.externalConfiguredIncoming, {
      force: true,
      recursive: true,
    });
  });

  const stageCompose = join(fixture.stage, "docker-compose.deploy.yml");

  assert.notEqual(fixture.code, 0);
  assert.match(
    fixture.stderr,
    /configured incoming directory must not be a symlink/,
  );
  assert.equal(
    (await lstat(fixture.configuredIncoming)).isSymbolicLink(),
    true,
  );
  assert.equal(
    await readlink(fixture.configuredIncoming),
    fixture.externalConfiguredIncoming,
  );
  assert.equal(
    await readFile(
      join(fixture.externalConfiguredIncoming, "sentinel"),
      "utf8",
    ),
    "do not modify external configured incoming\n",
  );
  assert.equal((await lstat(fixture.incomingArchive)).isFile(), true);
  await assert.rejects(lstat(fixture.stage));
  await assertPreviousReleaseRestored(fixture);
  assert.equal(await readFile(fixture.tarLog, "utf8"), "");
  assert.equal(await readFile(fixture.checksumLog, "utf8"), "");
  assert.equal(await readFile(fixture.nodeLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  await assert.rejects(readFile(stageCompose));
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses an archive checksum-manifest symlink before extraction", async (t) => {
  const fixture = await runDeployment({
    symlinkedStagedChecksumManifest: true,
  });
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true });
    await rm(fixture.externalChecksumManifest, {
      force: true,
      recursive: true,
    });
  });

  assert.notEqual(fixture.code, 0);
  assert.match(
    fixture.stderr,
    /release archive must not contain symlink or hardlink entries/,
  );
  assert.equal(
    await readFile(join(fixture.externalChecksumManifest, "sentinel"), "utf8"),
    "do not modify external checksum manifest\n",
  );
  await assert.rejects(lstat(fixture.stage));
  await assertPreviousReleaseRestored(fixture);
  assert.equal(await readFile(fixture.checksumLog, "utf8"), "");
  assert.equal(await readFile(fixture.nodeLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses an archive validator symlink before extraction", async (t) => {
  const fixture = await runDeployment({ symlinkedStagedValidator: true });
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true });
    await rm(fixture.externalValidator, { force: true, recursive: true });
  });

  assert.notEqual(fixture.code, 0);
  assert.match(
    fixture.stderr,
    /release archive must not contain symlink or hardlink entries/,
  );
  assert.equal(
    await readFile(join(fixture.externalValidator, "sentinel"), "utf8"),
    "do not modify external staged validator\n",
  );
  await assert.rejects(lstat(fixture.stage));
  assert.equal(await readFile(fixture.validatorExecutionLog, "utf8"), "");
  await assertPreviousReleaseRestored(fixture);
  assert.equal(await readFile(fixture.checksumLog, "utf8"), "");
  assert.equal(await readFile(fixture.nodeLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses an archive migrations checksum symlink before extraction", async (t) => {
  const fixture = await runDeployment({
    symlinkedStagedMigrationsChecksum: true,
  });
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true });
    await rm(fixture.externalMigrationsChecksum, {
      force: true,
      recursive: true,
    });
  });

  assert.notEqual(fixture.code, 0);
  assert.match(
    fixture.stderr,
    /release archive must not contain symlink or hardlink entries/,
  );
  assert.equal(
    await readFile(
      join(fixture.externalMigrationsChecksum, "sentinel"),
      "utf8",
    ),
    "do not modify external migrations checksum\n",
  );
  await assert.rejects(lstat(fixture.stage));
  await assertPreviousReleaseRestored(fixture);
  await assert.rejects(lstat(join(fixture.releases, version)));
  assert.equal(await readFile(fixture.checksumLog, "utf8"), "");
  assert.equal(await readFile(fixture.nodeLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  assert.equal(
    await readFile(join(fixture.root, ".migration-checksums"), "utf8"),
    "migrations\n",
  );
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses an archive release-directory symlink before extraction", async (t) => {
  const fixture = await runDeployment({ symlinkedStagedRelease: true });
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true });
    await rm(fixture.externalRelease, { force: true, recursive: true });
  });

  assert.notEqual(fixture.code, 0);
  assert.match(
    fixture.stderr,
    /release archive must not contain symlink or hardlink entries/,
  );
  assert.equal(
    await readFile(
      join(fixture.externalRelease, "release", "sentinel"),
      "utf8",
    ),
    "do not modify external staged release\n",
  );
  await assert.rejects(lstat(fixture.stage));
  await assertPreviousReleaseRestored(fixture);
  await assert.rejects(lstat(join(fixture.releases, version)));
  assert.equal(await readFile(fixture.checksumLog, "utf8"), "");
  assert.equal(await readFile(fixture.nodeLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses an archive release-content symlink before extraction", async (t) => {
  const fixture = await runDeployment({ symlinkedStagedReleaseContent: true });
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true });
    await rm(fixture.externalReleaseContent, { force: true, recursive: true });
  });

  assert.notEqual(fixture.code, 0);
  assert.match(
    fixture.stderr,
    /release archive must not contain symlink or hardlink entries/,
  );
  assert.equal(
    await readFile(join(fixture.externalReleaseContent, "sentinel"), "utf8"),
    "do not modify external staged release content\n",
  );
  await assert.rejects(lstat(fixture.stage));
  await assertPreviousReleaseRestored(fixture);
  await assert.rejects(lstat(join(fixture.releases, version)));
  assert.equal(await readFile(fixture.checksumLog, "utf8"), "");
  assert.equal(await readFile(fixture.nodeLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses linked archive entries before extraction", async (t) => {
  const fixture = await runDeployment({ linkedArchiveEntries: true });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  const stageCompose = join(fixture.stage, "docker-compose.deploy.yml");

  assert.notEqual(fixture.code, 0);
  assert.equal(
    fixture.stderr,
    "release archive must not contain symlink or hardlink entries\n",
  );
  await assert.rejects(lstat(fixture.stage));
  await assertPreviousReleaseRestored(fixture);
  assert.match(await readFile(fixture.tarLog, "utf8"), /-tzvf/);
  assert.doesNotMatch(await readFile(fixture.tarLog, "utf8"), /-xzf/);
  assert.equal(await readFile(fixture.checksumLog, "utf8"), "");
  assert.equal(await readFile(fixture.nodeLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  await assert.rejects(readFile(stageCompose));
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses an archive FIFO before extraction", async (t) => {
  const fixture = await runDeployment({ fifoArchiveEntry: true });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  const stageCompose = join(fixture.stage, "docker-compose.deploy.yml");

  assert.notEqual(fixture.code, 0);
  await assert.rejects(lstat(fixture.stage));
  await assertPreviousReleaseRestored(fixture);
  assert.match(await readFile(fixture.tarLog, "utf8"), /-tzvf/);
  assert.doesNotMatch(await readFile(fixture.tarLog, "utf8"), /-xzf/);
  assert.equal(await readFile(fixture.checksumLog, "utf8"), "");
  assert.equal(await readFile(fixture.nodeLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  await assert.rejects(readFile(stageCompose));
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses a symlinked staged deployment compose after Node validation", async (t) => {
  const fixture = await runDeployment({
    symlinkedStagedDeploymentCompose: true,
  });
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true });
    await rm(fixture.externalDeploymentCompose, {
      force: true,
      recursive: true,
    });
  });

  const stagedDeploymentCompose = join(
    fixture.stage,
    "docker-compose.deploy.yml",
  );
  const externalDeploymentCompose = join(
    fixture.externalDeploymentCompose,
    "docker-compose.deploy.yml",
  );

  assert.notEqual(fixture.code, 0);
  assert.equal(
    fixture.stderr,
    "staged deployment compose must not be a symlink\n",
  );
  assert.equal((await lstat(stagedDeploymentCompose)).isSymbolicLink(), true);
  assert.equal(
    await readlink(stagedDeploymentCompose),
    externalDeploymentCompose,
  );
  assert.equal(
    await readFile(externalDeploymentCompose, "utf8"),
    "do not modify external deployment compose\n",
  );
  await assertPreviousReleaseRestored(fixture);
  await assert.rejects(lstat(join(fixture.releases, version)));
  assert.notEqual(await readFile(fixture.checksumLog, "utf8"), "");
  assert.notEqual(await readFile(fixture.nodeLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses a symlinked staged server image archive before Docker load", async (t) => {
  const fixture = await runDeployment({
    symlinkedStagedServerImageArchive: true,
  });
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true });
    await rm(fixture.externalServerImageArchive, {
      force: true,
      recursive: true,
    });
  });

  const stagedServerImageArchive = join(
    fixture.stage,
    `synapse-server-${version}.tar`,
  );
  const externalArchive = join(
    fixture.externalServerImageArchive,
    `synapse-server-${version}.tar`,
  );

  assert.notEqual(fixture.code, 0);
  assert.equal(
    fixture.stderr,
    "staged server image archive must not be a symlink\n",
  );
  assert.equal((await lstat(stagedServerImageArchive)).isSymbolicLink(), true);
  assert.equal(await readlink(stagedServerImageArchive), externalArchive);
  assert.equal(await readFile(externalArchive, "utf8"), "server image\n");
  await assertPreviousReleaseRestored(fixture);
  await assert.rejects(lstat(join(fixture.releases, version)));
  assert.notEqual(await readFile(fixture.checksumLog, "utf8"), "");
  assert.notEqual(await readFile(fixture.nodeLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses a symlinked staged web image archive before Docker load", async (t) => {
  const fixture = await runDeployment({ symlinkedStagedWebImageArchive: true });
  t.after(async () => {
    await rm(fixture.root, { force: true, recursive: true });
    await rm(fixture.externalWebImageArchive, {
      force: true,
      recursive: true,
    });
  });

  const stagedWebImageArchive = join(
    fixture.stage,
    `synapse-web-${version}.tar`,
  );
  const externalArchive = join(
    fixture.externalWebImageArchive,
    `synapse-web-${version}.tar`,
  );

  assert.notEqual(fixture.code, 0);
  assert.equal(
    fixture.stderr,
    "staged web image archive must not be a symlink\n",
  );
  assert.equal((await lstat(stagedWebImageArchive)).isSymbolicLink(), true);
  assert.equal(await readlink(stagedWebImageArchive), externalArchive);
  assert.equal(await readFile(externalArchive, "utf8"), "web image\n");
  await assertPreviousReleaseRestored(fixture);
  await assert.rejects(lstat(join(fixture.releases, version)));
  assert.notEqual(await readFile(fixture.checksumLog, "utf8"), "");
  assert.notEqual(await readFile(fixture.nodeLog, "utf8"), "");
  assert.equal(await readFile(fixture.dockerLog, "utf8"), "");
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release refuses an existing stable release directory before staging", async (t) => {
  const fixture = await runDeployment({ existingStableRelease: true });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  const stableRelease = join(fixture.releases, version);
  const stageCompose = join(fixture.stage, "docker-compose.deploy.yml");

  assert.notEqual(fixture.code, 0);
  assert.match(fixture.stderr, /stable release directory already exists/);
  assert.equal(
    await readFile(join(stableRelease, "sentinel"), "utf8"),
    "do not modify\n",
  );
  await assertPreviousReleaseRestored(fixture);
  assert.equal(await readFile(fixture.composeLog, "utf8"), "");
  assert.equal(await readFile(fixture.backupLog, "utf8"), "");
  assert.equal(
    await readFile(join(fixture.stage, "stage-sentinel"), "utf8"),
    "do not modify staging\n",
  );
  await assert.rejects(readFile(stageCompose));
  assert.equal(
    await readFile(join(fixture.root, "docker-compose.yml"), "utf8"),
    fixture.compose,
  );
});

test("deploy release leaves the prior pointer untouched when an identity gate fails", async (t) => {
  const fixture = await runDeployment({ failHealth: true });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  assert.notEqual(fixture.code, 0);
  await assertPreviousReleaseRestored(fixture);
});

test("deploy release restores previous compose images after post-activation verification fails", async (t) => {
  const fixture = await runDeployment({ failPostActivation: true });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  assert.notEqual(fixture.code, 0);
  await assertPreviousReleaseRestored(fixture);
  assert.deepEqual(
    (await readFile(fixture.composeLog, "utf8")).trim().split("\n").slice(-2),
    ["    image: synapse-server:0.1.1", "    image: synapse-web:0.1.1"],
  );
});

test("deploy release replaces a stale rollback pointer after post-activation verification fails", async (t) => {
  const fixture = await runDeployment({
    failPostActivation: true,
    staleRollbackPointer: true,
  });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  assert.notEqual(fixture.code, 0);
  await assertPreviousReleaseRestored(fixture);
});

test("deploy release refuses a stale rollback directory without removing it", async (t) => {
  const fixture = await runDeployment({
    failPostActivation: true,
    staleRollbackDirectory: true,
  });
  t.after(() => rm(fixture.root, { force: true, recursive: true }));

  assert.notEqual(fixture.code, 0);
  assert.match(fixture.stderr, /unexpected rollback pointer/);
  assert.equal(
    (await lstat(join(fixture.releases, "current.rollback"))).isDirectory(),
    true,
  );
  await assertPreviousReleaseRestored(fixture);
});
