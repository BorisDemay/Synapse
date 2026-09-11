import { readFile, writeFile } from "node:fs/promises";

const version = process.argv[2];
if (!/^0\.1\.\d+$/u.test(version ?? ""))
  throw new Error("expected version 0.1.<run-number>");

const jsonFiles = [
  "package.json",
  "apps/web/package.json",
  "apps/desktop/package.json",
  "packages/ui/package.json",
  "packages/api-client/package.json",
];
for (const file of jsonFiles) {
  const value = JSON.parse(await readFile(file, "utf8"));
  value.version = version;
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

const rootCargo = await readFile("Cargo.toml", "utf8");
await writeFile(
  "Cargo.toml",
  rootCargo.replace(
    /(\[workspace\.package\][\s\S]*?\nversion = ")[^"]+/u,
    `$1${version}`,
  ),
);
const desktopCargo = await readFile(
  "apps/desktop/src-tauri/Cargo.toml",
  "utf8",
);
await writeFile(
  "apps/desktop/src-tauri/Cargo.toml",
  desktopCargo.replace(
    /(\[package\][\s\S]*?\nversion = ")[^"]+/u,
    `$1${version}`,
  ),
);
const tauriPath = "apps/desktop/src-tauri/tauri.conf.json";
const tauri = await readFile(tauriPath, "utf8");
// Preserve the checked-in formatting (notably compact arrays) for CI lint.
await writeFile(
  tauriPath,
  tauri.replace(/("version"\s*:\s*")[^"]+"/u, `$1${version}"`),
);
