<script setup lang="ts">
import { computed, ref } from "vue";
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
const isCreatingVault = computed(() => !vault.vaultName);

async function submit() {
  error.value = "";
  const creatingVault = isCreatingVault.value;
  try {
    busy.value = true;
    if (creatingVault) {
      await vault.openOnlineVault();
    }
    await vault.unlock(passphrase.value);
    passphrase.value = "";
    await router.push("/vault");
  } catch {
    passphrase.value = "";
    error.value = creatingVault
      ? "Création du coffre impossible."
      : "Impossible de déverrouiller la synchronisation.";
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
        <h1>
          {{
            isCreatingVault
              ? "Créer votre coffre chiffré."
              : "Déverrouiller la sync."
          }}
        </h1>
        <p>
          <template v-if="isCreatingVault">
            Aucun coffre n’existe encore sur cet appareil. Choisissez une
            nouvelle phrase pour protéger vos premières notes.
          </template>
          <template v-else>
            La phrase enveloppe la clé de votre coffre synchronisé.
          </template>
        </p>
      </div>
      <small
        >Jamais envoyée au serveur — elle ne peut pas être récupérée.</small
      >
    </section>
    <section class="auth-content">
      <div class="auth-card">
        <div class="page-toolbar">
          <span class="brand-mark"
            ><span class="brand-symbol" aria-hidden="true">S</span>Coffre</span
          >
          <ThemeToggle />
        </div>
        <h2>
          {{
            isCreatingVault
              ? "Choisissez une phrase de déchiffrement"
              : "Phrase de déchiffrement"
          }}
        </h2>
        <p class="subtitle">
          {{
            isCreatingVault
              ? "Utilisez une phrase longue, unique et mémorable. Elle est distincte du mot de passe de votre compte."
              : "Elle active la file chiffrée vers l’instance. Les notes restent aussi en fichiers Markdown sur cet appareil."
          }}
        </p>
        <form class="form-stack" @submit.prevent="submit">
          <div class="form-field">
            <label for="unlock-passphrase">
              {{
                isCreatingVault
                  ? "Nouvelle phrase de déchiffrement"
                  : "Phrase du coffre"
              }}
            </label>
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
            :label="
              busy
                ? 'Ouverture…'
                : isCreatingVault
                  ? 'Créer le coffre chiffré'
                  : 'Activer la synchronisation'
            "
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
