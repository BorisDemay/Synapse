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
});

test("pull requests retain verification without publication", async () => {
  const workflow = await readFile(".github/workflows/verify.yml", "utf8");
  assert.match(workflow, /pull_request:/u);
  assert.match(workflow, /desktop-native:/u);
  assert.match(workflow, /test:native/u);
  assert.match(workflow, /ubuntu-latest, windows-latest/u);
  assert.doesNotMatch(workflow, /gh release create|synapse-deploy/u);
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
  assert.equal(scripts["test:native"], "node e2e/native-webdriver-smoke.mjs");
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
