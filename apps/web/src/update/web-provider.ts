import type { UpdateMetadata, UpdateProvider } from "@synapse/ui";

export interface WebBuildIdentity {
  version: string;
  commitSha: string;
}

function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (version: string) =>
    version
      .split("-", 1)[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10));
  const left = parse(candidate);
  const right = parse(current);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

interface WebManifest {
  version: string;
  commit_sha: string;
  pub_date: string;
  notes: string;
}

function isWebManifest(value: unknown): value is WebManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<WebManifest>;
  return (
    typeof manifest.version === "string" &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version) &&
    typeof manifest.commit_sha === "string" &&
    /^[0-9a-f]{40,64}$/u.test(manifest.commit_sha) &&
    typeof manifest.pub_date === "string" &&
    Number.isFinite(Date.parse(manifest.pub_date)) &&
    typeof manifest.notes === "string"
  );
}

export function createWebUpdateProvider(
  current: WebBuildIdentity,
  fetcher: typeof fetch = fetch,
  reload: () => void = () => window.location.reload(),
): UpdateProvider {
  return {
    async check(): Promise<UpdateMetadata | null> {
      const response = await fetcher("/updates/stable/web.json", {
        cache: "no-store",
        credentials: "omit",
      });
      if (!response.ok) {
        throw new Error(`web update check failed (${response.status})`);
      }
      const manifest: unknown = await response.json();
      if (!isWebManifest(manifest)) {
        throw new Error("invalid web update metadata");
      }
      if (!isNewerVersion(manifest.version, current.version)) {
        return null;
      }
      return {
        commitSha: manifest.commit_sha,
        publishedAt: manifest.pub_date,
        releaseNotes: manifest.notes,
        version: manifest.version,
      };
    },
    async apply() {
      reload();
    },
  };
}
