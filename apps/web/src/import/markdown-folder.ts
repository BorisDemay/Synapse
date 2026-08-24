import { strFromU8, unzipSync } from "fflate";

const MAX_ENTRIES = 10_000;
const MAX_EXTRACTED_BYTES = 250 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set([
  "bat",
  "cmd",
  "com",
  "dll",
  "exe",
  "ps1",
  "scr",
  "so",
]);

export interface ImportSourceEntry {
  bytes: Uint8Array;
  contentType?: string;
  path: string;
}

export interface MarkdownImportPlan {
  attachments: { bytes: Uint8Array; contentType: string; path: string }[];
  ignored: { path: string; reason: string }[];
  notes: { content: string; path: string }[];
}

function normalizedPath(path: string): string | null {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized
      .split("/")
      .some((part) => !part || part === "." || part === "..") ||
    normalized.includes("\0") ||
    /^[A-Za-z]:/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function isObsidianConfiguration(path: string): boolean {
  return path === ".obsidian" || path.startsWith(".obsidian/");
}

function contentTypeFor(path: string, explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  const extension = path.split(".").pop()?.toLowerCase();
  return (
    {
      gif: "image/gif",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      mp3: "audio/mpeg",
      mp4: "video/mp4",
      pdf: "application/pdf",
      png: "image/png",
      svg: "image/svg+xml",
      txt: "text/plain",
      webp: "image/webp",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}

function attachmentPath(source: string): string {
  return `attachments/${source}`;
}

function rewriteAttachmentLinks(
  markdown: string,
  paths: ReadonlySet<string>,
): string {
  return markdown.replace(
    /(!?\[[^\]]*\]\()([^\s)]+)(\))/gu,
    (whole, prefix, target, suffix) => {
      const decoded = target.replaceAll("%20", " ");
      return paths.has(decoded)
        ? `${prefix}${attachmentPath(decoded)}${suffix}`
        : whole;
    },
  );
}

/**
 * Produces a preview only. The caller must ask the user for confirmation before
 * it writes any note or attachment into the encrypted vault/outbox.
 */
export function planMarkdownImport(
  entries: readonly ImportSourceEntry[],
): MarkdownImportPlan {
  const plan: MarkdownImportPlan = { attachments: [], ignored: [], notes: [] };
  if (entries.length > MAX_ENTRIES) {
    throw new Error("Import contains too many files");
  }
  let totalBytes = 0;
  const safeEntries: {
    bytes: Uint8Array;
    contentType?: string;
    path: string;
  }[] = [];
  for (const entry of entries) {
    totalBytes += entry.bytes.byteLength;
    if (totalBytes > MAX_EXTRACTED_BYTES) {
      throw new Error("Import is too large");
    }
    const path = normalizedPath(entry.path);
    if (!path) {
      plan.ignored.push({ path: entry.path, reason: "Unsafe path" });
    } else if (isObsidianConfiguration(path)) {
      plan.ignored.push({ path, reason: "Obsidian configuration" });
    } else {
      safeEntries.push({ ...entry, path });
    }
  }
  const assetPaths = new Set(
    safeEntries
      .filter((entry) => !entry.path.toLowerCase().endsWith(".md"))
      .map((entry) => entry.path),
  );
  for (const entry of safeEntries) {
    if (entry.path.toLowerCase().endsWith(".md")) {
      plan.notes.push({
        content: rewriteAttachmentLinks(strFromU8(entry.bytes), assetPaths),
        path: entry.path,
      });
      continue;
    }
    const extension = entry.path.split(".").pop()?.toLowerCase() ?? "";
    if (BLOCKED_EXTENSIONS.has(extension)) {
      plan.ignored.push({
        path: entry.path,
        reason: "Blocked attachment type",
      });
      continue;
    }
    if (entry.bytes.byteLength > 10 * 1024 * 1024) {
      plan.ignored.push({
        path: entry.path,
        reason: "Attachment exceeds 10 MiB",
      });
      continue;
    }
    plan.attachments.push({
      bytes: entry.bytes,
      contentType: contentTypeFor(entry.path, entry.contentType),
      path: attachmentPath(entry.path),
    });
  }
  return plan;
}

export function planZipImport(bytes: Uint8Array): MarkdownImportPlan {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("Invalid or encrypted ZIP archive");
  }
  return planMarkdownImport(
    Object.entries(entries).map(([path, entry]) => ({ bytes: entry, path })),
  );
}
