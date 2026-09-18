import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2];
const latest = JSON.parse(
  await readFile(join(root, "stable/latest.json"), "utf8"),
);
const web = JSON.parse(await readFile(join(root, "stable/web.json"), "utf8"));
if (
  !/^0\.1\.\d+$/u.test(latest.version) ||
  !/^[0-9a-f]{40,64}$/u.test(latest.commit_sha) ||
  latest.version !== web.version ||
  latest.commit_sha !== web.commit_sha ||
  !Number.isFinite(Date.parse(latest.pub_date)) ||
  !Number.isFinite(Date.parse(web.pub_date))
) {
  throw new Error("web and desktop release identities differ");
}
for (const platform of ["linux-x86_64", "windows-x86_64"]) {
  const entry = latest.platforms?.[platform];
  const expectedFile =
    platform === "linux-x86_64"
      ? "synapse-linux-x86_64.AppImage"
      : "synapse-windows-x86_64.exe";
  let url;
  try {
    url = new URL(entry?.url);
  } catch {
    url = undefined;
  }
  if (
    !entry?.signature ||
    !url ||
    url.protocol !== "https:" ||
    url.pathname !==
      `/updates/stable/${latest.version}/${expectedFile}` ||
    url.search ||
    url.hash
  ) {
    throw new Error(`invalid or mutable platform entry: ${platform}`);
  }
}
