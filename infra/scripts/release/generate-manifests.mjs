import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED = [
  ["linux-x86_64", "synapse-linux-x86_64.AppImage"],
  ["windows-x86_64", "synapse-windows-x86_64.exe"],
];

function validateOptions(options) {
  if (!/^0\.1\.\d+$/u.test(options.version))
    throw new Error("invalid release version");
  if (!/^[0-9a-f]{40,64}$/u.test(options.commitSha))
    throw new Error("invalid commit SHA");
  if (!Number.isFinite(Date.parse(options.publishedAt)))
    throw new Error("invalid publication date");
  const url = new URL(options.baseUrl);
  if (url.protocol !== "https:")
    throw new Error("release base URL must use HTTPS");
  return url.origin;
}

export async function generateReleaseManifests(options) {
  const baseUrl = validateOptions(options);
  const stable = join(options.output, "stable");
  const versioned = join(stable, options.version);
  await mkdir(versioned, { recursive: true });
  const platforms = {};
  for (const [platform, file] of REQUIRED) {
    const source = join(options.artifacts, file);
    let signature;
    try {
      signature = (await readFile(`${source}.sig`, "utf8")).trim();
      await copyFile(source, join(versioned, file));
      await copyFile(`${source}.sig`, join(versioned, `${file}.sig`));
    } catch {
      throw new Error(`missing required release artifact: ${file}`);
    }
    if (!signature) throw new Error(`empty updater signature: ${file}`);
    platforms[platform] = {
      signature,
      url: `${baseUrl}/updates/stable/${options.version}/${file}`,
    };
  }
  const identity = {
    commit_sha: options.commitSha,
    notes: options.notes,
    pub_date: options.publishedAt,
    version: options.version,
  };
  await writeFile(
    join(stable, "latest.json"),
    `${JSON.stringify({ ...identity, platforms }, null, 2)}\n`,
  );
  await writeFile(
    join(stable, "web.json"),
    `${JSON.stringify(identity, null, 2)}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await generateReleaseManifests({
    artifacts: process.env.SYNAPSE_RELEASE_ARTIFACTS,
    baseUrl: process.env.SYNAPSE_RELEASE_BASE_URL,
    commitSha: process.env.SYNAPSE_COMMIT_SHA,
    notes: process.env.SYNAPSE_RELEASE_NOTES ?? "",
    output: process.env.SYNAPSE_RELEASE_OUTPUT,
    publishedAt: process.env.SYNAPSE_RELEASE_PUBLISHED_AT,
    version: process.env.SYNAPSE_VERSION,
  });
}
