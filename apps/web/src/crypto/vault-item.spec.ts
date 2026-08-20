import { describe, expect, it } from "vitest";

import {
  decodeVaultItem,
  encodeNotePlaintext,
  encodeVaultItem,
  isBlockedAttachmentPath,
  legacyWebNotePath,
} from "./vault-item";

describe("vault item envelope", () => {
  it("round-trips a note path inside the plaintext item", () => {
    const encoded = encodeNotePlaintext("projects/roadmap.md", "# Secret");
    const decoded = decodeVaultItem(encoded);

    expect(new TextDecoder().decode(encoded)).toContain("projects/roadmap.md");
    expect(decoded).toEqual({
      kind: "note",
      markdown: "# Secret",
      path: "projects/roadmap.md",
    });
  });

  it("decodes legacy markdown without a header", () => {
    expect(decodeVaultItem(new TextEncoder().encode("# Ancienne note\n"))).toEqual({
      kind: "legacy",
      markdown: "# Ancienne note\n",
    });
  });

  it("round-trips an attachment under attachments/", () => {
    const encoded = encodeVaultItem({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
      kind: "attachment",
      path: "attachments/scan.pdf",
    });

    expect(decodeVaultItem(encoded)).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
      kind: "attachment",
      path: "attachments/scan.pdf",
    });
  });

  it("rejects blocked attachment paths", () => {
    expect(isBlockedAttachmentPath("attachments/../secret.pdf")).toBe(true);
    expect(isBlockedAttachmentPath("notes/scan.pdf")).toBe(true);
    expect(isBlockedAttachmentPath("attachments/payload.exe")).toBe(true);
    expect(isBlockedAttachmentPath("attachments/photo.png")).toBe(false);
  });

  it("derives a stable legacy web path", () => {
    expect(legacyWebNotePath("0198e5de-7777-7888-8999-aaaabbbbcccc")).toBe(
      "0198e5de.md",
    );
  });
});
