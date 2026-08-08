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
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ path: "nouvelle.md", label: "nouvelle.md" }]);

    const store = useVaultStore();
    await store.createNote("nouvelle.md", "# Nouvelle note");

    expect(invoke).toHaveBeenNthCalledWith(1, "write_note", {
      path: "nouvelle.md",
      content: "# Nouvelle note",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "list_notes");
    expect(store.nodes).toEqual([{ id: "nouvelle.md", label: "nouvelle.md" }]);
  });
});
