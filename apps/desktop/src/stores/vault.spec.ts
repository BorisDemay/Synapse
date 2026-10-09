import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useVaultStore } from "./vault";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("vault store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invoke.mockReset();
  });

  it("charge l'arborescence après l'ouverture d'un coffre", async () => {
    invoke.mockResolvedValueOnce({ name: "notes" }).mockResolvedValueOnce([
      { path: "inbox.md", label: "inbox.md" },
      { path: "projets/roadmap.md", label: "roadmap.md" },
    ]);

    const store = useVaultStore();
    await store.openVault();

    expect(store.vaultName).toBe("notes");
    expect(store.nodes).toEqual([
      { id: "inbox.md", label: "inbox.md" },
      { id: "projets/roadmap.md", label: "roadmap.md" },
    ]);
    expect(invoke).toHaveBeenNthCalledWith(1, "open_vault");
    expect(invoke).toHaveBeenNthCalledWith(2, "list_notes");
  });

  it("recherche des notes locales via la commande typée", async () => {
    invoke.mockResolvedValueOnce([
      { path: "projets/roadmap.md", label: "roadmap.md" },
    ]);

    const store = useVaultStore();
    await store.searchNotes("roadmap");

    expect(store.searchResults).toEqual([
      { id: "projets/roadmap.md", label: "roadmap.md" },
    ]);
    expect(invoke).toHaveBeenCalledWith("search_notes", { query: "roadmap" });
  });

  it("crée une note puis recharge l'arborescence", async () => {
    invoke
      .mockResolvedValueOnce({ hash: "ab".repeat(32), path: "nouvelle.md" })
      .mockResolvedValueOnce([{ path: "nouvelle.md", label: "nouvelle.md" }]);

    const store = useVaultStore();
    await store.createNote("nouvelle.md", "# Nouvelle note");

    expect(invoke).toHaveBeenNthCalledWith(1, "save_note", {
      content: "# Nouvelle note",
      expectedHash: null,
      path: "nouvelle.md",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "list_notes");
    expect(store.nodes).toEqual([{ id: "nouvelle.md", label: "nouvelle.md" }]);
  });

  it("pousse la file chiffrée après un enregistrement déverrouillé", async () => {
    invoke
      .mockResolvedValueOnce({ hash: "ab".repeat(32), path: "nouvelle.md" })
      .mockResolvedValueOnce([{ path: "nouvelle.md", label: "nouvelle.md" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ conflict: null, status: "synced" })
      .mockResolvedValueOnce([{ path: "nouvelle.md", label: "nouvelle.md" }]);

    const store = useVaultStore();
    store.isUnlocked = true;
    await store.saveNote({ content: "# Nouvelle note", id: "nouvelle.md" });

    expect(invoke).toHaveBeenCalledWith("flush_sync");
    expect(store.syncStatus).toBe("synced");
  });

  it("n'écrase pas le brouillon courant quand on réserve son chemin", () => {
    const store = useVaultStore();
    store.notes.set("nouvelle-note.md", { content: "# Nouvelle note" });
    expect(
      store.nextNotePath("# Nouvelle note\n\n", ["nouvelle-note.md"]),
    ).toBe("nouvelle-note-2.md");
  });

  it("ouvre un coffre en ligne sans dialogue de dossier", async () => {
    invoke
      .mockResolvedValueOnce({ name: "Notes en ligne", source: "online" })
      .mockResolvedValueOnce([]);

    const store = useVaultStore();
    await store.openOnlineVault();

    expect(invoke).toHaveBeenNthCalledWith(1, "open_online_vault");
    expect(store.vaultName).toBe("Notes en ligne");
    expect(store.vaultSource).toBe("online");
  });

  it("surfaces a disk conflict overlay without dropping the local draft", async () => {
    invoke
      .mockRejectedValueOnce("content_changed")
      .mockResolvedValueOnce("# Remote");

    const store = useVaultStore();
    store.notes.set("inbox.md", { content: "# Base" });
    await store.saveNote({ content: "# Local", id: "inbox.md" });

    expect(store.syncStatus).toBe("conflict");
    expect(store.activeConflict).toEqual({
      base: "# Base",
      local: "# Local",
      manualDraft: "# Local",
      noteId: "inbox.md",
      remote: "# Remote",
    });
  });

  it("applies a flush conflict report to the resolver overlay", async () => {
    invoke
      .mockResolvedValueOnce({
        conflict: {
          base: "# Base",
          local: "# Local",
          noteId: "inbox.md",
          remote: "# Remote",
        },
        status: "conflict",
      })
      .mockResolvedValueOnce([]);

    const store = useVaultStore();
    store.isUnlocked = true;
    await store.flushPendingOperations();

    expect(store.syncStatus).toBe("conflict");
    expect(store.activeConflict?.remote).toBe("# Remote");
    expect(store.activeConflict?.manualDraft).toBe("# Local");
  });

  it("envoie une note à la corbeille puis recharge l'arborescence", async () => {
    invoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ path: "kept.md", label: "kept.md" }]);

    const store = useVaultStore();
    store.notes.set("inbox.md", { content: "# Inbox" });
    store.notes.set("kept.md", { content: "# Kept" });
    store.hashes["inbox.md"] = "ab".repeat(32);

    await store.deleteNote("inbox.md");

    expect(invoke).toHaveBeenNthCalledWith(1, "trash_note", {
      path: "inbox.md",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "list_notes");
    expect(store.notes.has("inbox.md")).toBe(false);
    expect(store.hashes["inbox.md"]).toBeUndefined();
    expect(store.nodes).toEqual([{ id: "kept.md", label: "kept.md" }]);
  });

  it("charge backlinks, historique et pièces jointes via les commandes typées", async () => {
    invoke.mockResolvedValueOnce([{ path: "inbox.md", label: "Inbox" }]);
    const store = useVaultStore();
    await store.loadBacklinks("roadmap.md");
    expect(invoke).toHaveBeenCalledWith("list_backlinks", {
      path: "roadmap.md",
    });

    invoke.mockResolvedValueOnce([
      { label: "Révision 1", recordedAt: "2026-08-19", revision: 1 },
    ]);
    await store.loadHistory("inbox.md");
    expect(store.history[0]?.revision).toBe(1);

    invoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ path: "projets/inbox.md", label: "inbox.md" }]);
    await store.renameNote("inbox.md", "projets/inbox.md");
    expect(invoke).toHaveBeenCalledWith("rename_note", {
      source: "inbox.md",
      destination: "projets/inbox.md",
    });

    invoke
      .mockResolvedValueOnce({
        path: "attachments/photo.png",
        label: "photo.png",
      })
      .mockResolvedValueOnce([]);
    await store.saveAttachment("attachments/photo.png", [1, 2, 3]);
    expect(invoke).toHaveBeenCalledWith("save_attachment", {
      path: "attachments/photo.png",
      bytes: [1, 2, 3],
    });
  });

  it("réserve un chemin dans un dossier", () => {
    const store = useVaultStore();
    expect(store.nextNotePath("# Nouvelle note\n\n", [], "projets")).toBe(
      "projets/nouvelle-note.md",
    );
  });
});
