<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";

import { useVaultStore } from "./stores/vault";

const vault = useVaultStore();
const { nodes, vaultName } = storeToRefs(vault);
const notePath = ref("nouvelle.md");
const noteContent = ref("# Nouvelle note\n");
const isCreating = ref(false);
const errorMessage = ref("");

async function openVault() {
  errorMessage.value = "";
  try {
    await vault.openVault();
  } catch {
    errorMessage.value = "Impossible d’ouvrir le coffre.";
  }
}

async function createNote() {
  errorMessage.value = "";
  try {
    isCreating.value = true;
    await vault.createNote(notePath.value, noteContent.value);
  } catch {
    errorMessage.value = "Impossible de créer la note.";
  } finally {
    isCreating.value = false;
  }
}
</script>

<template>
  <main>
    <header>
      <h1>Synapse</h1>
      <button type="button" @click="openVault">Ouvrir un coffre</button>
    </header>

    <p v-if="vaultName" role="status">Coffre ouvert : {{ vaultName }}</p>
    <p v-else role="status">Aucun coffre ouvert.</p>
    <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>

    <form v-if="vaultName" @submit.prevent="createNote">
      <label for="note-path">Chemin du fichier</label>
      <input
        id="note-path"
        v-model="notePath"
        name="note-path"
        required
      />

      <label for="note-content">Contenu Markdown</label>
      <textarea id="note-content" v-model="noteContent" name="note-content" rows="8" />
      <button type="submit" :disabled="isCreating">
        {{ isCreating ? "Création…" : "Créer la note" }}
      </button>
    </form>

    <ul v-if="nodes.length" aria-label="Notes du coffre">
      <li v-for="node in nodes" :key="node.id">{{ node.label }}</li>
    </ul>
  </main>
</template>
