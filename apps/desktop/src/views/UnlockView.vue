<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

import Button from "primevue/button";
import Message from "primevue/message";
import Password from "primevue/password";

import { ThemeToggle } from "@synapse/ui";

import { useVaultStore } from "../stores/vault";

const vault = useVaultStore();
const router = useRouter();
const passphrase = ref("");
const error = ref("");
const busy = ref(false);

async function submit() {
  error.value = "";
  try {
    busy.value = true;
    if (!vault.vaultName) {
      await vault.openOnlineVault();
    }
    await vault.unlock(passphrase.value);
    passphrase.value = "";
    await router.push("/vault");
  } catch {
    passphrase.value = "";
    error.value = "Impossible de déverrouiller la synchronisation.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-aside" aria-label="À propos de Synapse">
      <div>
        <div class="auth-brand">
          <span class="brand-symbol" aria-hidden="true">S</span>
          <span>Synapse</span>
        </div>
        <h1>Déverrouiller la sync.</h1>
        <p>
          La phrase enveloppe la clé de coffre. Sans dossier ouvert, Synapse
          crée un coffre local synchronisé pour conserver vos notes en ligne.
        </p>
      </div>
      <small>Jamais envoyée au serveur.</small>
    </section>
    <section class="auth-content">
      <div class="auth-card">
        <div class="page-toolbar">
          <span class="brand-mark"
            ><span class="brand-symbol" aria-hidden="true">S</span>Coffre</span
          >
          <ThemeToggle />
        </div>
        <h2>Phrase de déchiffrement</h2>
        <p class="subtitle">
          Elle active la file chiffrée vers l’instance. Les notes restent aussi
          en fichiers Markdown sur cet appareil.
        </p>
        <form class="form-stack" @submit.prevent="submit">
          <div class="form-field">
            <label for="unlock-passphrase">Phrase du coffre</label>
            <Password
              input-id="unlock-passphrase"
              v-model="passphrase"
              :feedback="false"
              fluid
              autocomplete="off"
              required
              toggle-mask
            />
          </div>
          <Button
            :disabled="busy"
            :label="busy ? 'Ouverture…' : 'Activer la synchronisation'"
            type="submit"
          />
        </form>
        <p v-if="error" role="alert">
          <Message severity="error" :closable="false">{{ error }}</Message>
        </p>
      </div>
    </section>
  </main>
</template>
