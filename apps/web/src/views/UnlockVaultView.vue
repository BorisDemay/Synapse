<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { parseWrappedVaultKey, unlockVaultKey } from "../crypto/vault-key";
import { useVaultStore } from "../stores/vault";

const vault = useVaultStore();
const router = useRouter();
const passphrase = ref("");
const mode = ref<"loading" | "create" | "unlock">("loading");
const error = ref("");
const vaultId = ref<string | null>(null);

onMounted(async () => {
  try {
    const ids = await vault.listVaultIds();
    vaultId.value = ids[0] ?? null;
    if (!vaultId.value) {
      mode.value = "create";
      error.value =
        "Créez un coffre et une phrase de déchiffrement locale (distincte du mot de passe).";
      return;
    }
    vault.setHasEncryptedVault(true);
    mode.value = "unlock";
    error.value = "Ce coffre doit être déverrouillé localement.";
  } catch {
    error.value = "Impossible de découvrir le coffre.";
    mode.value = "create";
  }
});

async function submit() {
  const secret = passphrase.value;
  passphrase.value = "";
  error.value = "";
  try {
    if (mode.value === "create") {
      await vault.createAndUnlockVault(secret);
    } else if (vaultId.value) {
      const bytes = await vault.fetchEnvelopeBytes(vaultId.value);
      const envelope = parseWrappedVaultKey(bytes);
      const key = await unlockVaultKey(envelope, secret);
      vault.unlock(key, vaultId.value, 0);
      await vault.loadNotes(vaultId.value);
    } else {
      throw new Error("missing vault");
    }
    await router.push("/vault");
  } catch {
    error.value =
      mode.value === "create"
        ? "Création du coffre impossible."
        : "Déverrouillage impossible.";
  }
}
</script>

<template>
  <main>
    <h1>
      {{ mode === "create" ? "Créer un coffre" : "Déverrouiller le coffre" }}
    </h1>
    <p>La phrase de déchiffrement reste dans ce navigateur.</p>
    <form v-if="mode !== 'loading'" @submit.prevent="submit">
      <label
        >Phrase de déchiffrement
        <input v-model="passphrase" autocomplete="off" required type="password"
      /></label>
      <button type="submit">
        {{ mode === "create" ? "Créer et déverrouiller" : "Déverrouiller" }}
      </button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
  </main>
</template>
