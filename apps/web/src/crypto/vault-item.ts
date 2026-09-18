const ITEM_MAGIC = "SYNAPSE-ITEM-v1";
export const MAX_ITEM_BYTES = 10 * 1024 * 1024;
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

export type VaultItem =
  | { kind: "note"; path: string; markdown: string }
  | {
      bytes: Uint8Array;
      contentType: string;
      kind: "attachment";
      path: string;
    };

export type DecodedVaultItem = { kind: "legacy"; markdown: string } | VaultItem;

export function encodeVaultItem(item: VaultItem): Uint8Array {
  const headerLines = [
    `${ITEM_MAGIC}`,
    `kind: ${item.kind}`,
    `path: ${item.path}`,
  ];
  let body: Uint8Array;
  if (item.kind === "note") {
    body = new TextEncoder().encode(item.markdown);
  } else {
    headerLines.push(`content-type: ${item.contentType}`);
    body = item.bytes;
  }
  const header = new TextEncoder().encode(`${headerLines.join("\n")}\n\n`);
  const encoded = new Uint8Array(header.length + body.length);
  encoded.set(header);
  encoded.set(body, header.length);
  if (encoded.byteLength > MAX_ITEM_BYTES) {
    throw new Error("Vault item is too large");
  }
  return encoded;
}

export function encodeNotePlaintext(
  path: string,
  markdown: string,
): Uint8Array {
  return encodeVaultItem({ kind: "note", markdown, path });
}

export function decodeVaultItem(bytes: Uint8Array): DecodedVaultItem {
  if (bytes.byteLength > MAX_ITEM_BYTES) {
    throw new Error("Vault item is too large");
  }
  const magic = new TextEncoder().encode(`${ITEM_MAGIC}\n`);
  if (!startsWith(bytes, magic)) {
    return { kind: "legacy", markdown: new TextDecoder().decode(bytes) };
  }
  const rest = bytes.subarray(magic.length);
  const headerEnd = indexOfDoubleNewline(rest);
  if (headerEnd < 0) {
    throw new Error("Vault item is malformed");
  }
  const header = new TextDecoder().decode(rest.subarray(0, headerEnd));
  const body = rest.subarray(headerEnd + 2);
  const fields = new Map<string, string>();
  for (const line of header.split("\n")) {
    if (!line) {
      continue;
    }
    const separator = line.indexOf(": ");
    if (separator < 0) {
      throw new Error("Vault item is malformed");
    }
    fields.set(line.slice(0, separator), line.slice(separator + 2));
  }
  const kind = fields.get("kind");
  const path = fields.get("path");
  if (!kind || !path) {
    throw new Error("Vault item is malformed");
  }
  if (kind === "note") {
    return {
      kind: "note",
      markdown: new TextDecoder().decode(body),
      path,
    };
  }
  if (kind === "attachment") {
    return {
      bytes: body,
      contentType: fields.get("content-type") ?? "application/octet-stream",
      kind: "attachment",
      path,
    };
  }
  throw new Error("Vault item kind is unknown");
}

export function decodedNoteMarkdown(decoded: DecodedVaultItem): string | null {
  if (decoded.kind === "legacy" || decoded.kind === "note") {
    return decoded.markdown;
  }
  return null;
}

export function legacyWebNotePath(noteId: string): string {
  return `${noteId.slice(0, 8)}.md`;
}

export function isBlockedAttachmentPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized.startsWith("attachments/") || normalized.includes("..")) {
    return true;
  }
  const extension = normalized.split(".").pop()?.toLowerCase() ?? "";
  return BLOCKED_EXTENSIONS.has(extension);
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }
  return prefix.every((value, index) => bytes[index] === value);
}

function indexOfDoubleNewline(bytes: Uint8Array): number {
  for (let index = 0; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 10 && bytes[index + 1] === 10) {
      return index;
    }
  }
  return -1;
}
