import { invoke } from "@tauri-apps/api/core";
import { defineStore } from "pinia";

import type { AssistantCredential } from "../crypto/ai-credential";

export interface VaultNode {
  id: string;
  label: string;
}

interface OpenedVault {
  name: string;
  source: "folder" | "online";
}

interface NoteSummary {
  hash?: string;
  path: string;
  label: string;
}

interface SavedNote {
  hash: string;
  path: string;
}

export interface DesktopConflict {
  base: string;
  local: string;
  manualDraft: string;
  noteId: string;
  remote: string;
}

export type SyncStatus = "saving" | "synced" | "offline" | "conflict" | "error";

function noteTitle(markdown: string, fallback: string): string {
  const heading = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));
  if (heading) {
    return heading.replace(/^#+\s+/, "").trim() || fallback;
  }
  const firstLine = markdown
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine?.slice(0, 48) || fallback;
}

function slugFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "nouvelle";
}

export const useVaultStore = defineStore("vault", {
  state: () => ({
    activeConflict: null as DesktopConflict | null,
    hashes: {} as Record<string, string>,
    isUnlocked: false,
    lastError: null as string | null,
    notes: new Map<string, { content: string }>(),
    nodes: [] as VaultNode[],
    attachments: [] as VaultNode[],
    pendingNoteIds: [] as string[],
    searchResults: [] as VaultNode[],
    backlinks: [] as VaultNode[],
    history: [] as { label: string; recordedAt: string; revision: number }[],
    tagFilter: "",
    syncStatus: "offline" as SyncStatus,
    vaultName: "",
    vaultSource: "folder" as "folder" | "online",
  }),
  actions: {
    async openVault() {
      const opened = await invoke<OpenedVault | null>("open_vault");
      if (!opened) {
        return;
      }
      this.vaultName = opened.name;
      this.vaultSource = opened.source ?? "folder";
      await this.reloadNotes();
    },
    async openOnlineVault() {
      const opened = await invoke<OpenedVault>("open_online_vault");
      this.vaultName = opened.name;
      this.vaultSource = opened.source ?? "online";
      await this.reloadNotes();
    },
    async reloadNotes() {
      const listed = await invoke<NoteSummary[]>("list_notes");
      this.nodes = listed.map((note) => ({
        id: note.path,
        label: note.label,
      }));
      const attached = await Promise.resolve(
        invoke<NoteSummary[]>("list_attachments"),
      ).catch(() => [] as NoteSummary[]);
      this.attachments = Array.isArray(attached)
        ? attached.map((file) => ({
            id: file.path,
            label: file.label,
          }))
        : [];
      const pending = await Promise.resolve(
        invoke<string[]>("pending_note_ids"),
      ).catch(() => []);
      this.pendingNoteIds = Array.isArray(pending) ? pending : [];
      const next = new Map<string, { content: string }>();
      for (const note of listed) {
        if (note.hash) {
          this.hashes[note.path] = note.hash;
        }
        const existing = this.notes.get(note.path);
        if (existing) {
          next.set(note.path, existing);
          continue;
        }
        const content = await invoke<string>("read_note", { path: note.path });
        next.set(note.path, { content });
      }
      this.notes = next;
    },
    async readNote(path: string) {
      const content = await invoke<string>("read_note", { path });
      this.notes.set(path, { content });
      return content;
    },
    async createNote(path: string, content: string) {
      await this.saveNote({ content, id: path });
    },
    async deleteNote(path: string) {
      await invoke("trash_note", { path });
      this.notes.delete(path);
      delete this.hashes[path];
      await this.reloadNotes();
    },
    nextNotePath(content: string, reserved: string[] = [], folder = "") {
      const base = slugFromTitle(noteTitle(content, "nouvelle"));
      const prefix = folder ? `${folder.replace(/\/$/u, "")}/` : "";
      let path = `${prefix}${base}.md`;
      let index = 2;
      const used = new Set([
        ...this.nodes.map((node) => node.id),
        ...this.notes.keys(),
        ...reserved,
      ]);
      while (used.has(path)) {
        path = `${prefix}${base}-${index}.md`;
        index += 1;
      }
      return path;
    },
    async saveNote(input: { content: string; id: string }) {
      this.syncStatus = "saving";
      this.lastError = null;
      try {
        const saved = await invoke<SavedNote>("save_note", {
          content: input.content,
          expectedHash: this.hashes[input.id] ?? null,
          path: input.id,
        });
        this.hashes[saved.path] = saved.hash;
        this.notes.set(saved.path, { content: input.content });
        await this.reloadNotes();
        if (this.isUnlocked) {
          await this.flushPendingOperations();
        } else {
          this.syncStatus = "offline";
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("content_changed")) {
          this.syncStatus = "conflict";
          this.lastError = "La note a changé sur le disque.";
          const remote = await invoke<string>("read_note", { path: input.id });
          this.activeConflict = {
            base: this.notes.get(input.id)?.content ?? "",
            local: input.content,
            manualDraft: input.content,
            noteId: input.id,
            remote,
          };
          return;
        }
        this.syncStatus = "error";
        this.lastError = "Enregistrement impossible.";
        throw error;
      }
    },
    async searchNotes(query: string) {
      const notes = await invoke<NoteSummary[]>("search_notes", { query });
      this.searchResults = notes.map((note) => ({
        id: note.path,
        label: note.label,
      }));
    },
    async loadBacklinks(path: string) {
      this.backlinks = (
        await invoke<NoteSummary[]>("list_backlinks", { path })
      ).map((note) => ({ id: note.path, label: note.label }));
    },
    async loadHistory(path: string) {
      this.history = await invoke("list_history", { path });
    },
    async restoreRevision(path: string, revision: number) {
      await invoke("restore_revision", { path, revision });
      await this.reloadNotes();
      const content = await this.readNote(path);
      await this.loadHistory(path);
      return content;
    },
    async renameNote(source: string, destination: string) {
      await invoke("rename_note", { source, destination });
      await this.reloadNotes();
    },
    async saveAttachment(path: string, bytes: number[]) {
      await invoke("save_attachment", { path, bytes });
      await this.reloadNotes();
    },
    async readAttachment(path: string) {
      return invoke<number[]>("read_attachment", { path });
    },
    noteSyncStatus(
      id: string,
    ): "conflict" | "error" | "offline" | "pending" | "synced" {
      if (this.activeConflict?.noteId === id) {
        return "conflict";
      }
      if (this.pendingNoteIds.includes(id)) {
        return "pending";
      }
      if (this.syncStatus === "error") {
        return "error";
      }
      return this.syncStatus === "offline" ? "offline" : "synced";
    },
    setActiveConflict(conflict: DesktopConflict | null) {
      this.activeConflict = conflict;
    },
    async resolveConflict(content: string) {
      if (!this.activeConflict) {
        throw new Error("No active conflict");
      }
      const path = this.activeConflict.noteId;
      this.activeConflict = null;
      delete this.hashes[path];
      await this.saveNote({ content, id: path });
    },
    async unlock(passphrase: string) {
      await invoke("unlock_vault", { passphrase });
      this.isUnlocked = true;
      this.syncStatus = "synced";
      await this.flushPendingOperations();
    },
    async lock() {
      await invoke("lock_vault");
      this.isUnlocked = false;
      this.syncStatus = "offline";
    },
    async changePassphrase(current: string, next: string) {
      await invoke("change_passphrase", { current, next });
    },
    async flushPendingOperations() {
      if (!this.isUnlocked) {
        return;
      }
      try {
        const report = await invoke<{
          conflict: DesktopConflict | null;
          status: SyncStatus;
        }>("flush_sync");
        this.syncStatus = report.status;
        if (report.conflict) {
          this.activeConflict = {
            ...report.conflict,
            manualDraft: report.conflict.local,
          };
        }
        await this.reloadNotes();
      } catch {
        this.syncStatus = "offline";
      }
    },
    async persistAssistantCredential(credential: AssistantCredential) {
      await invoke("persist_assistant_credential", {
        json: JSON.stringify(credential),
      });
    },
    async loadAssistantCredential(): Promise<AssistantCredential | null> {
      const json = await invoke<string | null>("load_assistant_credential");
      return json ? (JSON.parse(json) as AssistantCredential) : null;
    },
    async forgetAssistantCredential() {
      await invoke("forget_assistant_credential");
    },
    async persistAssistantConversations(snapshot: unknown) {
      await invoke("persist_assistant_conversations", {
        json: JSON.stringify(snapshot),
      });
    },
    async loadAssistantConversations(): Promise<unknown | null> {
      const json = await invoke<string | null>("load_assistant_conversations");
      return json ? JSON.parse(json) : null;
    },
  },
});
