<script setup lang="ts">
import {
  AppShell,
  ConflictResolver,
  MarkdownEditor,
  MarkdownPreview,
  VaultTree,
  type VaultTreeNode,
} from "@synapse/ui";
import { computed, onMounted, onUnmounted, ref } from "vue";

import { uuidV7 } from "../crypto/vault-key";
import { useVaultStore } from "../stores/vault";

const vault = useVaultStore();
const content = ref("# Nouvelle note\n\nÉcrivez ici…\n");
const noteId = ref<string>(uuidV7());
const selectedNoteId = ref<string | null>(null);
const formError = ref("");

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

const treeNodes = computed<VaultTreeNode[]>(() =>
  Array.from(vault.notes.entries()).map(([id, note]) => ({
    id,
    label: noteTitle(note.content, id.slice(0, 8)),
  })),
);

function selectNote(id: string) {
  selectedNoteId.value = id;
  noteId.value = id;
  content.value = vault.notes.get(id)?.content ?? "";
  formError.value = "";
}

function startNewNote() {
  noteId.value = uuidV7();
  selectedNoteId.value = null;
  content.value = "# Nouvelle note\n\n";
  formError.value = "";
}

async function save(nextContent = content.value) {
  content.value = nextContent;
  formError.value = "";
  try {
    await vault.saveNote({
      content: nextContent,
      id: noteId.value,
    });
    selectedNoteId.value = noteId.value;
    if (vault.syncStatus === "error" || vault.syncStatus === "conflict") {
      formError.value = vault.lastError ?? "Enregistrement impossible.";
    }
  } catch (error) {
    formError.value =
      error instanceof Error ? error.message : "Enregistrement impossible.";
  }
}

async function onOnline() {
  await vault.flushPendingOperations();
}

async function resolveWith(contentChoice: string) {
  formError.value = "";
  const conflictNoteId = vault.activeConflict?.noteId;
  try {
    await vault.resolveConflict(contentChoice);
    content.value = contentChoice;
    if (conflictNoteId) {
      noteId.value = conflictNoteId;
      selectedNoteId.value = conflictNoteId;
    }
  } catch (error) {
    formError.value =
      error instanceof Error ? error.message : "Résolution impossible.";
  }
}

onMounted(() => {
  window.addEventListener("online", onOnline);
  if (navigator.onLine) {
    void vault.flushPendingOperations();
  }
});

onUnmounted(() => {
  window.removeEventListener("online", onOnline);
});
</script>

<template>
  <AppShell class="vault-page">
    <template #navigation>
      <header class="vault-nav-header">
        <h1>Coffre</h1>
        <p role="status">{{ vault.syncStatus }}</p>
        <button type="button" @click="startNewNote">Nouvelle note</button>
      </header>
      <VaultTree :nodes="treeNodes" @select="selectNote" />
    </template>

    <section class="vault-workspace" aria-label="Édition de note">
      <ConflictResolver
        v-if="vault.activeConflict"
        :base="vault.activeConflict.base"
        :local="vault.activeConflict.local"
        :remote="vault.activeConflict.remote"
        :manual-draft="vault.activeConflict.manualDraft"
        @update:manual-draft="vault.activeConflict.manualDraft = $event"
        @keep-local="resolveWith(vault.activeConflict.local)"
        @keep-remote="resolveWith(vault.activeConflict.remote)"
        @edit-manual="resolveWith(vault.activeConflict.manualDraft)"
      />
      <template v-else>
        <div class="vault-panes">
          <MarkdownEditor v-model="content" @save="save" />
          <MarkdownPreview :source="content" />
        </div>
        <div class="vault-actions">
          <button type="button" @click="save()">Enregistrer</button>
        </div>
      </template>
      <p v-if="formError || vault.lastError" role="alert">
        {{ formError || vault.lastError }}
      </p>
    </section>
  </AppShell>
</template>

<style scoped>
.vault-page {
  display: grid;
  grid-template-columns: minmax(14rem, 18rem) 1fr;
  min-height: 100vh;
  background:
    radial-gradient(ellipse 80% 50% at 0% 0%, #d9e4ef 0%, transparent 55%),
    linear-gradient(160deg, #e8edf2 0%, #f3f5f7 45%, #e4e9ee 100%);
}

.vault-page > :deep(aside) {
  border-right: 1px solid #b8c2cc;
  background: rgba(243, 246, 249, 0.92);
  padding: 1rem;
}

.vault-page > :deep(main) {
  padding: 1rem 1.25rem;
  min-width: 0;
}

.vault-nav-header {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.vault-nav-header h1 {
  margin: 0;
  font-size: 1.25rem;
}

.vault-workspace {
  display: grid;
  grid-template-rows: 1fr auto auto;
  gap: 0.75rem;
  height: calc(100vh - 2rem);
}

.vault-panes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  min-height: 0;
}

.vault-panes :deep(.markdown-editor),
.vault-panes :deep(.markdown-preview) {
  min-height: 24rem;
  border: 1px solid #b8c2cc;
  overflow: auto;
  background: #fbfcfd;
}

.vault-panes :deep(.markdown-editor .cm-editor) {
  height: 100%;
  min-height: 24rem;
}

.vault-panes :deep(.markdown-preview) {
  padding: 1rem 1.25rem;
  line-height: 1.55;
}

.vault-actions {
  display: flex;
  gap: 0.75rem;
}

@media (max-width: 860px) {
  .vault-page {
    grid-template-columns: 1fr;
  }

  .vault-panes {
    grid-template-columns: 1fr;
  }
}
</style>
