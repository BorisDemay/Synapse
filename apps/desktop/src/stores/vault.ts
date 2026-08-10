import { invoke } from "@tauri-apps/api/core";
import { defineStore } from "pinia";

export interface VaultNode {
  id: string;
  label: string;
}

interface OpenedVault {
  name: string;
}

interface NoteSummary {
  path: string;
  label: string;
}

export interface DesktopConflict {
  base: string;
  local: string;
  noteId: string;
  remote: string;
}

export const useVaultStore = defineStore("vault", {
  state: () => ({
    activeConflict: null as DesktopConflict | null,
    nodes: [] as VaultNode[],
    searchResults: [] as VaultNode[],
    vaultName: "",
  }),
  actions: {
    async openVault() {
      const opened = await invoke<OpenedVault | null>("open_vault");
      if (!opened) {
        return;
      }

      const notes = await invoke<NoteSummary[]>("list_notes");
      this.vaultName = opened.name;
      this.nodes = notes.map((note) => ({
        id: note.path,
        label: note.label,
      }));
    },
    async createNote(path: string, content: string) {
      await invoke("write_note", { path, content });
      const notes = await invoke<NoteSummary[]>("list_notes");
      this.nodes = notes.map((note) => ({
        id: note.path,
        label: note.label,
      }));
    },
    async searchNotes(query: string) {
      const notes = await invoke<NoteSummary[]>("search_notes", { query });
      this.searchResults = notes.map((note) => ({
        id: note.path,
        label: note.label,
      }));
    },
    setActiveConflict(conflict: DesktopConflict | null) {
      this.activeConflict = conflict;
    },
    async resolveConflict(content: string) {
      if (!this.activeConflict) {
        throw new Error("No active conflict");
      }
      await invoke("write_note", {
        content,
        path: this.activeConflict.noteId,
      });
      this.activeConflict = null;
    },
  },
});
