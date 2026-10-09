import path from "node:path";

export function resolveDesktopBinaryPath(root, platform) {
  const executable = `synapse-desktop${platform === "win32" ? ".exe" : ""}`;
  return path.join(root, "apps/desktop/src-tauri/target/debug", executable);
}
