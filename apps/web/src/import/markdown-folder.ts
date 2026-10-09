import { strFromU8, unzip } from "fflate";

const MAX_ENTRIES = 10_000;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 250 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
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
  return source.startsWith("attachments/") ? source : `attachments/${source}`;
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

export async function planZipImport(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<MarkdownImportPlan> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("Import is too large");
  }
  const entries = await extractZip(bytes, signal);
  return planMarkdownImport(
    Object.entries(entries).map(([path, entry]) => ({ bytes: entry, path })),
  );
}

type ZipWorkerResponse =
  | { kind: "success"; entries: Record<string, Uint8Array> }
  | { kind: "entries" | "bytes" | "invalid" };

function zipError(kind: "entries" | "bytes" | "invalid"): Error {
  if (kind === "entries") return new Error("Import contains too many files");
  if (kind === "bytes") return new Error("Import is too large");
  return new Error("Invalid or encrypted ZIP archive");
}

function extractZipOnMain(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<Record<string, Uint8Array>> {
  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    let entryCount = 0;
    let extractedBytes = 0;
    let limitError: "entries" | "bytes" | undefined;
    let terminated = false;
    let terminate: (() => void) | undefined;
    const abortError = () => new Error("ZIP import cancelled");
    const finish = (callback: () => void) => {
      signal?.removeEventListener("abort", onAbort);
      if (!terminated) {
        terminated = true;
        callback();
      }
    };
    const onAbort = () => {
      terminate?.();
      finish(() => reject(abortError()));
    };
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      terminate = unzip(
        bytes,
        {
          filter: (file) => {
            entryCount += 1;
            if (entryCount > MAX_ENTRIES) {
              limitError = "entries";
              return false;
            }
            const originalSize = file.originalSize;
            if (
              originalSize === undefined ||
              !Number.isSafeInteger(originalSize) ||
              originalSize < 0 ||
              originalSize > MAX_ENTRY_BYTES ||
              extractedBytes > MAX_EXTRACTED_BYTES - originalSize
            ) {
              limitError = "bytes";
              return false;
            }
            extractedBytes += originalSize;
            return true;
          },
        },
        (error, data) => {
          if (terminated) return;
          if (error) {
            finish(() => reject(zipError("invalid")));
          } else if (limitError) {
            finish(() => reject(zipError(limitError!)));
          } else {
            finish(() => resolve(data));
          }
        },
      );
    } catch {
      finish(() => reject(zipError("invalid")));
    }
  });
}

function extractZipInWorker(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<Record<string, Uint8Array>> {
  if (signal?.aborted) {
    return Promise.reject(new Error("ZIP import cancelled"));
  }
  let worker: Worker;
  try {
    worker = new Worker(
      new URL("./markdown-folder.worker.ts", import.meta.url),
      { type: "module" },
    );
  } catch {
    return extractZipOnMain(bytes, signal);
  }
  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      callback();
    };
    const onAbort = () =>
      finish(() => reject(new Error("ZIP import cancelled")));
    if (signal?.aborted) {
      finish(() => reject(new Error("ZIP import cancelled")));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<ZipWorkerResponse>) => {
      const result = event.data;
      if (result.kind === "success") {
        finish(() => resolve(result.entries));
      } else {
        finish(() => reject(zipError(result.kind)));
      }
    };
    worker.onerror = () => finish(() => reject(zipError("invalid")));
    const archive = bytes.slice().buffer;
    try {
      worker.postMessage({ archive }, [archive]);
    } catch {
      finish(() => reject(zipError("invalid")));
    }
  });
}

async function extractZip(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<Record<string, Uint8Array>> {
  // Browser workers keep even small fflate entries off the UI thread. Vitest
  // and server-side callers may not provide Worker; retain the same metadata
  // checks in that compatibility path.
  if (typeof Worker === "undefined") {
    return extractZipOnMain(bytes, signal);
  }
  return extractZipInWorker(bytes, signal);
}
