// Used only by the temporary --debug --no-bundle E2E build, never release config.
export function nativeTestConfig(
  config,
  { identifier, dataDirectory, platform, debugPort },
) {
  if (
    platform === "win32" &&
    (!Number.isInteger(debugPort) || debugPort < 1 || debugPort > 65535)
  ) {
    throw new Error("Invalid native debugging port");
  }
  return {
    identifier,
    app: {
      windows: config.app.windows.map((window) => ({
        ...window,
        dataDirectory,
        // WebView2 150+ drops WEBVIEW2_* overrides in elevated processes.
        // Tauri forwards this configuration through the WebView2 API instead.
        ...(platform === "win32"
          ? {
              additionalBrowserArgs: `--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1`,
            }
          : {}),
      })),
    },
  };
}
