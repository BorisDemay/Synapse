import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("main release is serialized, parity gated, and deploys before publishing", async () => {
  const workflow = await readFile(".github/workflows/main-release.yml", "utf8");
  assert.match(workflow, /branches:\s*\[main\]/u);
  assert.match(workflow, /group:\s*synapse-stable-main/u);
  assert.match(workflow, /cancel-in-progress:\s*false/u);
  assert.match(workflow, /needs:\s*\[desktop, images\]/u);
  assert.ok(
    workflow.indexOf("Deploy staged release") <
      workflow.indexOf("Create immutable GitHub release"),
  );
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/u);
  assert.match(workflow, /WINDOWS_CERTIFICATE_PFX_BASE64/u);
  assert.match(
    workflow,
    /timestampUrl\s*=\s*"https:\/\/timestamp\.digicert\.com"/u,
  );
});

test("pull requests retain verification without publication", async () => {
  const workflow = await readFile(".github/workflows/verify.yml", "utf8");
  assert.match(workflow, /pull_request:/u);
  assert.match(workflow, /desktop-native:/u);
  assert.match(workflow, /test:native/u);
  assert.match(workflow, /ubuntu-latest, windows-latest/u);
  assert.doesNotMatch(workflow, /gh release create|synapse-deploy/u);
});

test("release workflows pin every third-party action to an immutable commit", async () => {
  for (const path of [
    ".github/workflows/verify.yml",
    ".github/workflows/main-release.yml",
  ]) {
    const workflow = await readFile(path, "utf8");
    assert.doesNotMatch(workflow, /uses:\s*[^\s@]+@(?:v|stable|main|master)/u);
    for (const line of workflow.split("\n")) {
      if (line.includes("uses:")) {
        assert.match(line, /uses:\s*[^\s@]+@[0-9a-f]{40}\b/u, line);
      }
    }
  }
});

test("desktop-native runs the maintained native WebDriver smoke on every platform", async () => {
  const [workflow, desktopPackage] = await Promise.all([
    readFile(".github/workflows/verify.yml", "utf8"),
    readFile("apps/desktop/package.json", "utf8"),
  ]);
  const scripts = JSON.parse(desktopPackage).scripts;

  assert.match(
    workflow,
    /runner\.os == 'Linux'[\s\S]*?xvfb-run -a pnpm --filter @synapse\/desktop test:native/u,
  );
  assert.match(
    workflow,
    /runner\.os == 'Windows'[\s\S]*?pnpm --filter @synapse\/desktop test:native/u,
  );
  assert.equal(
    scripts["test:native"],
    "node --experimental-strip-types e2e/native-webdriver-smoke.mjs",
  );
  assert.doesNotMatch(scripts["test:native"], /e2e\/native\.mjs/u);
});

test("NAS deployment health-gates manifest-last activation and keeps rollback", async () => {
  const script = await readFile("infra/scripts/deploy-release.sh", "utf8");
  const health = script.indexOf("/health/version");
  const webIdentity = script.indexOf("/build.json");
  const activation = script.indexOf('latest.json" "$RELEASES/latest.json.next');
  assert.ok(health >= 0 && webIdentity > health && activation > webIdentity);
  assert.match(script, /rollback\(\)/u);
  assert.match(script, /infra\/scripts\/backup\.sh/u);
  assert.match(script, /sha256sum --check SHA256SUMS/u);
  assert.match(script, /for attempt in \{1\.\.30\}/u);
  assert.match(script, /synapse-windows-x86_64\.exe/u);
});

test("both native matrices provision isolated Windows PostgreSQL and gate release bundles", async () => {
  for (const path of [
    ".github/workflows/verify.yml",
    ".github/workflows/main-release.yml",
  ]) {
    const workflow = await readFile(path, "utf8");
    assert.match(workflow, /native-ci-windows\.ps1 -Action start/u);
    assert.match(workflow, /native-ci-windows\.ps1 -Action stop/u);
    assert.match(workflow, /always\(\) && runner\.os == 'Windows'/u);
    assert.match(
      workflow,
      /dbus-run-session -- xvfb-run -a pnpm --filter @synapse\/desktop test:native/u,
    );
    assert.match(workflow, /webkit2gtk-driver xvfb xdotool dbus-x11 openbox/u);
    assert.match(workflow, /cargo install tauri-driver --locked/u);
    assert.match(workflow, /Native Tauri recovery/u);
    if (path.includes("main-release")) {
      assert.ok(
        workflow.indexOf("Native Tauri recovery") <
          workflow.indexOf("Build signed updater bundle"),
      );
    }
  }
});

test("desktop jobs generate Tauri icons after installing dependencies and before native compilation", async () => {
  const iconCommand =
    "pnpm --filter @synapse/desktop exec tauri icon src-tauri/icons/icon.svg";
  const workflows = [
    [".github/workflows/verify.yml", "desktop-native", "test:native"],
    [".github/workflows/main-release.yml", "desktop", "tauri build"],
  ];

  for (const [path, jobName, consumer] of workflows) {
    const workflow = await readFile(path, "utf8");
    const jobStart = workflow.indexOf(`  ${jobName}:\n`);
    assert.notEqual(jobStart, -1, `${path} contains the ${jobName} job`);
    const followingJob = workflow
      .slice(jobStart + 1)
      .search(/\n  [a-z][\w-]*:\n/u);
    const job = workflow.slice(
      jobStart,
      followingJob === -1 ? undefined : jobStart + 1 + followingJob,
    );

    assert.match(
      job,
      new RegExp(
        `- name: Generate desktop icons\\n\\s+run: ${iconCommand}`,
        "u",
      ),
    );
    assert.ok(
      job.indexOf("pnpm install --frozen-lockfile") < job.indexOf(iconCommand),
    );
    assert.ok(job.indexOf(iconCommand) < job.indexOf(consumer));
  }
});
