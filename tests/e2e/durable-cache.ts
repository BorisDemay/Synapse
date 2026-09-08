import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import {
  parseWrappedVaultKey,
  unlockVaultKey,
} from "../../apps/web/src/crypto/vault-key";
import {
  decodeVaultItem,
  decodedNoteMarkdown,
} from "../../apps/web/src/crypto/vault-item";
const requireWeb = createRequire(resolve("apps/web/package.json"));
const { xchacha20poly1305 } = requireWeb(
  "@noble/ciphers/chacha.js",
) as typeof import("../../apps/web/node_modules/@noble/ciphers/chacha.js");
const keys = new Map<string, Uint8Array>();
/** Inspect only synthetic test ciphertext, decrypting outside the application to prove durable content. */
export async function persistedMarkdown(
  page: Page,
  passphrase: string,
): Promise<string[]> {
  const data = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("synapse-offline-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(["notes", "envelopes"]);
      const get = (store: string) =>
        new Promise<any[]>((resolve, reject) => {
          const request = tx.objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      return { notes: await get("notes"), envelopes: await get("envelopes") };
    } finally {
      db.close();
    }
  });
  const result: string[] = [];
  for (const envelope of data.envelopes) {
    const id = `${envelope.userId}:${envelope.vaultId}:${JSON.stringify(envelope.bytes)}`;
    let key = keys.get(id);
    if (!key) {
      key = await unlockVaultKey(
        parseWrappedVaultKey(envelope.bytes),
        passphrase,
      );
      keys.set(id, key);
    }
    for (const note of data.notes.filter(
      (note) =>
        note.userId === envelope.userId && note.vaultId === envelope.vaultId,
    )) {
      const plaintext = xchacha20poly1305(
        key,
        Uint8Array.from(note.nonce),
        new TextEncoder().encode(
          `synapse/aad/1/${note.vaultId}/${note.noteId}/${note.revision}`,
        ),
      ).decrypt(Uint8Array.from(note.ciphertext));
      try {
        const markdown = decodedNoteMarkdown(decodeVaultItem(plaintext));
        if (markdown !== null) result.push(markdown.trim());
      } catch {
        /* Tombstones are not markdown. */
      }
    }
  }
  return result;
}
