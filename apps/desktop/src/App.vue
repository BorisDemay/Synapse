<script setup lang="ts">
import { storeToRefs } from "pinia";

import { useVaultStore } from "./stores/vault";

const vault = useVaultStore();
const { nodes, vaultName } = storeToRefs(vault);
</script>

<template>
  <main>
    <header>
      <h1>Synapse</h1>
      <button type="button" @click="vault.openVault">Ouvrir un coffre</button>
    </header>
    <p v-if="vaultName" role="status">Coffre ouvert : {{ vaultName }}</p>
    <p v-else role="status">Aucun coffre ouvert.</p>
    <ul v-if="nodes.length" aria-label="Notes du coffre">
      <li v-for="node in nodes" :key="node.id">{{ node.label }}</li>
    </ul>
  </main>
</template>
