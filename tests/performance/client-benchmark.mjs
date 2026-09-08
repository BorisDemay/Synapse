import { createServer } from "../../apps/web/node_modules/vite/dist/node/index.js";
import { chromium } from "@playwright/test";
import { resolve } from "node:path";

const count = Number(process.env.SYNAPSE_BENCH_NOTES ?? 10000);
const timeout = Number(process.env.SYNAPSE_BENCH_TIMEOUT_MS ?? 30000);
const server = await createServer({
  root: resolve("apps/web"),
  configFile: resolve("apps/web/vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port: 16174,
    strictPort: true,
    hmr: false,
    watch: null,
  },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let pulls = 0;
  let remoteDelta;
  const pullCursors = [];
  await page.route("**/v1/**", (route) => {
    if (route.request().url().includes("/operations")) {
      pulls++;
      pullCursors.push(
        new URL(route.request().url()).searchParams.get("cursor"),
      );
      const delta = remoteDelta;
      remoteDelta = undefined;
      return route.fulfill({
        status: 200,
        json: {
          protocol_version: 1,
          operations: delta ? [delta] : [],
          next_cursor: delta ? "benchmark-cursor-2" : null,
        },
      });
    }
    return route.fulfill({ status: 401, json: {} });
  });
  await page.goto("http://127.0.0.1:16174/login");
  const result = await page.evaluate(
    async ({ count, timeout }) => {
      const { useVaultStore } = await import("/src/stores/vault.ts");
      const { useAuthStore } = await import("/src/stores/auth.ts");
      const { openOfflineDb, noteKey, revisionKey } = await import(
        "/src/offline/db.ts"
      );
      const { wrapVaultKey, encodeWrappedVaultKey } = await import(
        "/src/crypto/vault-key.ts"
      );
      const { putCachedEnvelope } = await import("/src/offline/cache.ts");
      const { encodeNotePlaintext } = await import("/src/crypto/vault-item.ts");
      const { xchacha20poly1305 } = await import(
        "/node_modules/@noble/ciphers/chacha.js"
      ).catch(
        () => import("/node_modules/.vite/deps/@noble_ciphers_chacha__js.js"),
      );
      const auth = useAuthStore();
      await auth.enterLocalMode();
      const vault = useVaultStore();
      const vaultId = "0198e5de-1111-7222-8333-444455556666";
      const key = crypto.getRandomValues(new Uint8Array(32));
      await putCachedEnvelope(
        auth.userId,
        vaultId,
        encodeWrappedVaultKey(
          await wrapVaultKey(key, "synthetic benchmark passphrase"),
        ),
      );
      const db = await openOfflineDb();
      const records = [];
      const fixtureStart = performance.now();
      for (let i = 0; i < count; i++) {
        const noteId = `0198e5de-7777-7888-8999-${String(i).padStart(12, "0")}`;
        const nonce = crypto.getRandomValues(new Uint8Array(24));
        const ciphertext = xchacha20poly1305(
          key,
          nonce,
          new TextEncoder().encode(`synapse/aad/1/${vaultId}/${noteId}/0`),
        ).encrypt(
          encodeNotePlaintext(
            `notes/note-${String(i).padStart(5, "0")}.md`,
            `# Note ${i}\n\n#benchmark [[Note ${(i + 1) % count}]]\n${"Synthetic local fixture. ".repeat(42)}`,
          ),
        );
        records.push({
          userId: auth.userId,
          vaultId,
          noteId,
          nonce: Array.from(nonce),
          ciphertext: Array.from(ciphertext),
          ciphertextHash: "fixture-only",
          revision: 0,
        });
      }
      const tx = db.transaction(["notes", "note_revisions"], "readwrite");
      for (const record of records) {
        tx.objectStore("notes").put(
          record,
          noteKey(record.userId, vaultId, record.noteId),
        );
        tx.objectStore("note_revisions").put(
          { ...record, baseRevision: 0, recordedAt: "2026-09-08T00:00:00Z" },
          revisionKey(record.userId, vaultId, record.noteId, 0),
        );
      }
      await tx.done;
      const fixture_ms = performance.now() - fixtureStart;
      vault.unlock(key, vaultId, 0);
      key.fill(0);
      const longTasks = [];
      const observer = new PerformanceObserver((list) =>
        longTasks.push(...list.getEntries().map((entry) => entry.duration)),
      );
      observer.observe({ type: "longtask" });
      const started = performance.now();
      const opened = await Promise.race([
        vault.loadNotes(vaultId).then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), timeout)),
      ]);
      const open_ms = performance.now() - started;
      if (!opened)
        return {
          notes: count,
          fixture_ms,
          open_timeout_ms: open_ms,
          loaded_notes: vault.notes.size,
        };
      if (vault.notes.size !== count) throw new Error("Incomplete cache open");
      if (
        !vault
          .searchNotes("Note 0")
          .some((note) => note.id.endsWith("000000000000"))
      )
        throw new Error("Search correctness failed");
      const queries = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        vault.searchNotes(`Note ${i * 417}`);
        queries.push(performance.now() - start);
      }
      queries.sort((a, b) => a - b);
      window.__benchmark = { vault, auth, vaultId, save: null };
      vault.$onAction(({ name, after }) => {
        if (name === "saveNote") {
          const start = performance.now();
          after(() => {
            window.__benchmark.save = performance.now() - start;
          });
        }
      });
      const renderStart = performance.now();
      await document
        .querySelector("#app")
        .__vue_app__.config.globalProperties.$router.push("/vault");
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (
        document.querySelector("#app").__vue_app__.config.globalProperties
          .$router.currentRoute.value.path !== "/vault"
      )
        throw new Error("Benchmark did not render the vault");
      return {
        notes: count,
        fixture_ms,
        open_ms,
        longest_task_ms: Math.max(0, ...longTasks),
        search_median_ms: queries[10],
        search_p95_ms: queries[19],
        render_ms: performance.now() - renderStart,
        treeitems: document.querySelectorAll('[role="treeitem"]').length,
        dom_elements: document.querySelectorAll("*").length,
      };
    },
    { count, timeout },
  );
  if (!result.open_timeout_ms) {
    await page.getByRole("treeitem").first().click();
    const editor = page.getByRole("textbox", {
      name: "Éditeur Markdown",
      exact: true,
    });
    await editor.waitFor({ state: "visible" });
    const start = Date.now();
    await editor.fill("# Edited benchmark note\n\nDurable local edit.");
    const deadline = Date.now() + 10000;
    while (await page.evaluate(() => window.__benchmark.save === null)) {
      if (Date.now() > deadline) throw new Error("Editor did not durably save");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    result.edit_to_durable_ms = Date.now() - start;
    result.save_action_ms = await page.evaluate(() => window.__benchmark.save);
    await page.reload();
    const reopened = await page.evaluate(async (count) => {
      const { useAuthStore } = await import("/src/stores/auth.ts");
      const { useVaultStore } = await import("/src/stores/vault.ts");
      const { getCachedEnvelope } = await import("/src/offline/cache.ts");
      const { parseWrappedVaultKey, unlockVaultKey } = await import(
        "/src/crypto/vault-key.ts"
      );
      const auth = useAuthStore();
      await auth.enterLocalMode();
      const vault = useVaultStore();
      const vaultId = "0198e5de-1111-7222-8333-444455556666";
      const key = await unlockVaultKey(
        parseWrappedVaultKey(await getCachedEnvelope(auth.userId, vaultId)),
        "synthetic benchmark passphrase",
      );
      vault.unlock(key, vaultId, 0);
      await vault.loadNotes(vaultId);
      if (
        ![...vault.notes.values()].some((note) =>
          note.content.includes("Durable local edit."),
        )
      )
        throw new Error("Durable edit did not survive reload");
      const { xchacha20poly1305 } = await import(
        "/node_modules/@noble/ciphers/chacha.js"
      );
      const { encodeNotePlaintext } = await import("/src/crypto/vault-item.ts");
      const { setCachedPullCursor } = await import("/src/offline/cache.ts");
      const noteId = `0198e5de-7777-7888-8999-${String(count - 1).padStart(12, "0")}`;
      const nonce = crypto.getRandomValues(new Uint8Array(24));
      const ciphertext = xchacha20poly1305(
        key,
        nonce,
        new TextEncoder().encode(`synapse/aad/1/${vaultId}/${noteId}/0`),
      ).encrypt(
        encodeNotePlaintext(
          `notes/note-${String(count - 1).padStart(5, "0")}.md`,
          "# Remote benchmark delta",
        ),
      );
      key.fill(0);
      await setCachedPullCursor(auth.userId, vaultId, "benchmark-cursor-1");
      window.__benchmark = { auth, vault, vaultId, noteId };
      return {
        delta: {
          protocol_version: 1,
          operation_id: "0198e5de-aaaa-7bbb-8ccc-ddddeeeefff1",
          vault_id: vaultId,
          note_id: noteId,
          base_revision: 0,
          revision: 1,
          aad_version: 1,
          nonce: Array.from(nonce),
          ciphertext: Array.from(ciphertext),
          ciphertext_hash: "aa".repeat(32),
        },
      };
    }, count);
    result.reopen_verified = true;
    remoteDelta = reopened.delta;
    result.reconnect_ms = await page.evaluate(async () => {
      const { auth, vault } = window.__benchmark;
      auth.isLocalMode = false;
      const start = performance.now();
      await vault.synchronize();
      if (
        vault.notes.get(window.__benchmark.noteId)?.content !==
        "# Remote benchmark delta"
      )
        throw new Error("Incremental delta not applied");
      return performance.now() - start;
    });
    result.incremental_pull_requests = pulls;
    if (
      pullCursors[0] !== "benchmark-cursor-1" ||
      pullCursors[1] !== "benchmark-cursor-2"
    )
      throw new Error("Incremental cursor was not replayed");
    result.incremental_delta_verified = true;
  }
  console.log(JSON.stringify(result));
  if (result.open_timeout_ms) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
