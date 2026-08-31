import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2];
const latest = JSON.parse(
  await readFile(join(root, "stable/latest.json"), "utf8"),
);
const web = JSON.parse(await readFile(join(root, "stable/web.json"), "utf8"));
if (latest.version !== web.version || latest.commit_sha !== web.commit_sha) {
  throw new Error("web and desktop release identities differ");
}
for (const platform of ["linux-x86_64", "windows-x86_64"]) {
  const entry = latest.platforms?.[platform];
  if (!entry?.signature || !entry.url?.includes(`/${latest.version}/`)) {
    throw new Error(`invalid or mutable platform entry: ${platform}`);
  }
}
