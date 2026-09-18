import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("main release is serialized, parity gated, and publishes before pull deployment", async () => {
  const workflow = await readFile(".github/workflows/main-release.yml", "utf8");
  assert.match(workflow, /branches:\s*\[main\]/u);
  assert.match(workflow, /group:\s*synapse-stable-main/u);
  assert.match(workflow, /cancel-in-progress:\s*false/u);
  const publish = workflow.slice(workflow.indexOf("  publish:\n"));
  assert.match(publish, /needs:\n(?:\s+-\s+[\w-]+\n)+/u);
  for (const job of [
    "verify-code",
    "verify-e2e",
    "verify-selfhosted",
    "verify-recovery",
    "desktop-native",
    "desktop-bundle",
    "images",
  ]) {
    assert.match(publish, new RegExp(`\\n\\s+- ${job}\\n`, "u"));
  }
  assert.ok(workflow.indexOf("Publish the immutable GitHub release") >= 0);
  assert.doesNotMatch(workflow, /scp .*incoming|synapse-deploy/u);
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/u);
  assert.match(workflow, /WINDOWS_CERTIFICATE_PFX_BASE64/u);
  assert.match(workflow, /\$selfSigned = \$cert\.Subject -eq \$cert\.Issuer/u);
  assert.match(workflow, /"https:\/\/timestamp\.digicert\.com"/u);
});

test("Windows bundling probes Authenticode before the release build", async () => {
  const workflow = await readFile(".github/workflows/main-release.yml", "utf8");
  assert.match(workflow, /Import-PfxCertificate/u);
  assert.match(workflow, /\$cert\.HasPrivateKey/u);
  assert.match(workflow, /Authenticode probe signing failed/u);
  assert.match(workflow, /Authenticode timestamp probe failed/u);
  assert.match(workflow, /non-zero signtool exit/u);
  assert.match(workflow, /tauri build --verbose --bundles/u);
  assert.match(workflow, /PSObject\.Properties\.Remove\('timestampUrl'\)/u);
  assert.match(workflow, /@\('NotTrusted', 'UnknownError'\)/u);
  assert.match(
    workflow,
    /Add-Member -NotePropertyName windows/u,
    "an existing bundle.windows configuration is merged, not replaced",
  );
});

test("pull requests retain verification without publication", async () => {
  const workflow = await readFile(".github/workflows/verify.yml", "utf8");
  assert.match(workflow, /pull_request:/u);
  assert.match(workflow, /desktop-native:/u);
  assert.match(workflow, /test:native/u);
  assert.match(workflow, /ubuntu-latest/u);
  assert.match(workflow, /windows-latest/u);
  assert.doesNotMatch(workflow, /gh release create|synapse-deploy/u);
});

test("Windows diagnosis reuses native verification without publishing or full-suite work", async () => {
  const workflow = await readFile(".github/workflows/verify.yml", "utf8");
  assert.match(workflow, /branches: \[ci\/windows-native\]/u);
  assert.match(workflow, /if: github.event_name != 'push'/u);
  assert.match(
    workflow,
    /github.event_name == 'push' && fromJSON\('\["windows-latest"\]'\)/u,
  );
  assert.doesNotMatch(workflow, /contents: write|secrets\.|synapse-deploy/u);
});

test("parallel release work remains gated by all checks without duplicate verification", async () => {
  const workflow = await readFile(".github/workflows/main-release.yml", "utf8");
  const justfile = await readFile("justfile", "utf8");
  assert.doesNotMatch(workflow, /needs: verify/u);
  assert.doesNotMatch(workflow, /- run: just verify\b/u);
  assert.match(workflow, /- run: just fmt-check clippy/u);
  assert.match(workflow, /- run: just e2e-recovery/u);
  assert.match(
    workflow,
    /- run: just test-recovery-backup test-release-drill/u,
  );
  assert.match(justfile, /verify: [^\n]*test-native-rust[^\n]*test-release/u);
  assert.doesNotMatch(workflow, /- run: cargo test --manifest-path/u);
  assert.match(workflow, /tauri build\b[^\n]*--bundles/u);
  assert.match(workflow, /cache-on-failure: true/u);
  assert.match(workflow, /cache-to: type=gha,scope=synapse-server,mode=min/u);
  assert.match(workflow, /transiently unsuccessful; retrying once/u);
});

test("parallel quality jobs cover exactly the just verify gate list", async () => {
  const justfile = await readFile("justfile", "utf8");
  const verifyLine = justfile.match(/^verify: (.+)$/mu)?.[1];
  assert.ok(verifyLine, "the verify recipe lists its gates");
  const gates = verifyLine.trim().split(/\s+/u);

  for (const path of [
    ".github/workflows/main-release.yml",
    ".github/workflows/verify.yml",
  ]) {
    const workflow = await readFile(path, "utf8");
    assert.doesNotMatch(
      workflow,
      /- run: just verify\b/u,
      `${path} must run the gates as parallel jobs, not one long recipe`,
    );
    const invoked = new Set();
    for (const match of workflow.matchAll(/- run: just ([^\n]+)/gu)) {
      for (const token of match[1].trim().split(/\s+/u)) invoked.add(token);
    }
    if (
      invoked.has("test-recovery-selfhosted") &&
      invoked.has("test-recovery-backup")
    ) {
      invoked.add("test-recovery");
    }
    for (const gate of gates) {
      assert.ok(
        invoked.has(gate),
        `${path} must run the ${gate} gate in a parallel job`,
      );
    }
  }
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
  const activation = script.indexOf(
    'mv -T "$RELEASES/current.next" "$RELEASES/current"',
  );
  assert.ok(health >= 0 && webIdentity > health && activation > webIdentity);
  const servedLatest = script.indexOf('served_identity "stable latest.json"');
  const servedWeb = script.indexOf('served_identity "stable web.json"');
  assert.ok(
    servedLatest > activation && servedWeb > servedLatest,
    "stable manifests are verified through the public URLs after activation",
  );
  assert.match(script, /rollback\(\)/u);
  assert.match(script, /infra\/scripts\/backup\.sh/u);
  assert.match(script, /sha256sum --check SHA256SUMS/u);
  assert.match(script, /for attempt in \{1\.\.30\}/u);
  assert.match(script, /synapse-windows-x86_64\.exe/u);
});

test("stable manifest URLs resolve through one atomically replaced release pointer", async () => {
  const [script, nginx] = await Promise.all([
    readFile("infra/scripts/deploy-release.sh", "utf8"),
    readFile("apps/web/nginx.conf", "utf8"),
  ]);

  const health = script.indexOf("/health/version");
  const rollbackArmed = script.indexOf("CURRENT_ACTIVATED=true");
  const activation = script.indexOf(
    'mv -T "$RELEASES/current.next" "$RELEASES/current"',
  );
  assert.ok(
    health >= 0 && rollbackArmed > health && activation > rollbackArmed,
  );
  assert.match(
    script,
    /cp "\$STAGE\/release\/stable\/latest\.json" "\$RELEASES\/\$VERSION\.pending\/latest\.json"/u,
  );
  assert.match(
    script,
    /cp "\$STAGE\/release\/stable\/web\.json" "\$RELEASES\/\$VERSION\.pending\/web\.json"/u,
  );
  assert.match(script, /ln -s "\$VERSION" "\$RELEASES\/current\.next"/u);
  assert.match(
    script,
    /\[\[ ! -e "\$RELEASES\/\$VERSION\.pending" && ! -L "\$RELEASES\/\$VERSION\.pending" \]\]/u,
  );
  assert.match(script, /test -f "\$RELEASES\/\$VERSION\/latest\.json"/u);
  assert.match(script, /test -f "\$RELEASES\/\$VERSION\/web\.json"/u);
  assert.match(
    script,
    /ln -s "\$PREVIOUS_VERSION" "\$RELEASES\/current\.rollback"/u,
  );
  assert.match(
    script,
    /mv -T "\$RELEASES\/current\.rollback" "\$RELEASES\/current"/u,
  );
  assert.doesNotMatch(script, /mv "\$RELEASES\/latest\.json\.next"/u);
  assert.doesNotMatch(script, /mv "\$RELEASES\/web\.json\.next"/u);
  assert.match(
    nginx,
    /location = \/updates\/stable\/latest\.json \{[\s\S]*?alias \/usr\/share\/nginx\/updates\/stable\/current\/latest\.json;/u,
  );
  assert.match(
    nginx,
    /location = \/updates\/stable\/web\.json \{[\s\S]*?alias \/usr\/share\/nginx\/updates\/stable\/current\/web\.json;/u,
  );
  assert.match(
    nginx,
    /location \/updates\/stable\/ \{[\s\S]*?root \/usr\/share\/nginx;/u,
  );
});

test("desktop artifacts are verified against the updater public key before upload and publication", async () => {
  const workflow = await readFile(".github/workflows/main-release.yml", "utf8");
  const build = workflow.indexOf("Build signed updater bundle");
  const desktopVerify = workflow.indexOf(
    "Verify updater signatures against the public key",
  );
  const desktopUpload = workflow.indexOf("- uses: actions/upload-artifact");
  const publishVerify = workflow.indexOf(
    "Verify downloaded updater signatures",
  );
  const assemble = workflow.indexOf("Assemble and validate parity release");

  assert.ok(build >= 0 && desktopVerify > build);
  assert.ok(desktopVerify < desktopUpload);
  assert.ok(publishVerify > desktopUpload && publishVerify < assemble);
  assert.equal(
    workflow.match(/verify-signature\.mjs/gu)?.length,
    4,
    "desktop (Linux and Windows) and publish jobs invoke the signature verifier",
  );
  assert.match(
    workflow,
    /Verify downloaded updater signatures\n\s+env:\n\s+SYNAPSE_UPDATER_PUBLIC_KEY/u,
  );
  assert.match(
    workflow,
    /verify-signature\.mjs downloaded\/synapse-linux-x86_64\.AppImage/u,
  );
  assert.match(
    workflow,
    /verify-signature\.mjs downloaded\/synapse-windows-x86_64\.exe/u,
  );
  assert.match(
    workflow,
    /pattern: "\{desktop-Linux,desktop-Windows,server-web\}"/u,
    "publish downloads only the release artifacts, not the buildx cache",
  );
});

test("publishes the release with retried parallel asset uploads", async () => {
  const workflow = await readFile(".github/workflows/main-release.yml", "utf8");
  assert.match(
    workflow,
    /gh release create "\$tag" --draft --target "\$SYNAPSE_COMMIT_SHA"/u,
  );
  assert.match(workflow, /gh release edit "\$tag" --draft=false/u);
  assert.match(workflow, /for attempt in 1 2 3 4 5/u);
  assert.match(workflow, /gh release upload "\$tag" --clobber "\$asset"/u);
  assert.match(
    workflow,
    /xargs -0 -P 4 -n 1 bash -c 'upload_asset "\$0"'/u,
    "release assets upload in parallel",
  );
});

test("publishes the deployment archive for pull-based instance updaters", async () => {
  const [workflow, updater] = await Promise.all([
    readFile(".github/workflows/main-release.yml", "utf8"),
    readFile("infra/scripts/update-instance.sh", "utf8"),
  ]);
  assert.match(
    workflow,
    /tar -C payload -czf "synapse-\$SYNAPSE_VERSION\.tar\.gz"/u,
  );
  assert.match(updater, /releases\/latest/u);
  assert.match(updater, /synapse-\$version\.tar\.gz/u);
  assert.match(updater, /SYNAPSE_DEPLOY_COMMAND/u);
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
    assert.match(
      workflow,
      /command -v tauri-driver[^\n]*cargo install tauri-driver --version 2\.0\.6 --locked/u,
    );
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
    [".github/workflows/main-release.yml", "desktop-native", "test:native"],
    [".github/workflows/main-release.yml", "desktop-bundle", "tauri build"],
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
    if (job.includes("--test local_folder")) {
      assert.ok(
        job.indexOf(iconCommand) < job.indexOf("--test local_folder"),
        `${jobName} generates icons before the native filesystem tests`,
      );
    }
  }
});

test("the Linux bundle job installs the Tauri build prerequisites", async () => {
  const workflow = await readFile(".github/workflows/main-release.yml", "utf8");
  const bundle = workflow.slice(
    workflow.indexOf("  desktop-bundle:\n"),
    workflow.indexOf("  images:\n"),
  );
  assert.match(bundle, /Install desktop bundle prerequisites/u);
  assert.match(
    bundle,
    /if: runner\.os == 'Linux'\n\s+run: sudo apt-get update[^\n]*libwebkit2gtk-4\.1-dev/u,
  );
});
