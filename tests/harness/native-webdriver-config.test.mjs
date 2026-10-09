import assert from "node:assert/strict";
import test from "node:test";
import { nativeTestConfig } from "../../apps/desktop/e2e/native-webdriver-config.mjs";

const config = {
  identifier: "app.synapse",
  app: { windows: [{ label: "main", title: "Synapse" }] },
};

test("Windows native test passes loopback CDP arguments through the WebView2 API", () => {
  const override = nativeTestConfig(config, {
    identifier: "app.synapse.test",
    dataDirectory: "test-profile",
    platform: "win32",
    debugPort: 43210,
  });
  assert.equal(override.identifier, "app.synapse.test");
  assert.equal(override.app.windows[0].dataDirectory, "test-profile");
  assert.match(
    override.app.windows[0].additionalBrowserArgs,
    /--remote-debugging-port=43210\b/u,
  );
  assert.match(
    override.app.windows[0].additionalBrowserArgs,
    /--remote-debugging-address=127\.0\.0\.1\b/u,
  );
  assert.equal(config.app.windows[0].additionalBrowserArgs, undefined);
  assert.equal(config.app.windows[0].dataDirectory, undefined);
});

test("Linux native test does not enable a Chromium debugging port", () => {
  const override = nativeTestConfig(config, {
    identifier: "app.synapse.test",
    dataDirectory: "test-profile",
    platform: "linux",
  });
  assert.equal(override.app.windows[0].additionalBrowserArgs, undefined);
});

test("Windows debugging port must be an explicit valid TCP port", () => {
  for (const debugPort of [
    undefined,
    0,
    -1,
    65536,
    1.5,
    "43210 --other-flag",
  ]) {
    assert.throws(
      () =>
        nativeTestConfig(config, {
          identifier: "app.synapse.test",
          dataDirectory: "test-profile",
          platform: "win32",
          debugPort,
        }),
      /Invalid native debugging port/u,
    );
  }
});
