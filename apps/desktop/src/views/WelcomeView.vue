<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

import { ThemeToggle } from "@synapse/ui";

import { useVaultStore } from "../stores/vault";

const vault = useVaultStore();
const router = useRouter();
const error = ref("");
const busy = ref(false);

async function openLocalVault() {
  error.value = "";
  busy.value = true;
  try {
    await vault.openVault();
    if (vault.vaultName) {
      await router.push("/vault");
    }
  } catch {
    error.value = "Impossible d’ouvrir le dossier.";
  } finally {
    busy.value = false;
  }
}

async function connectOnlineVault() {
  await router.push("/login");
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
        <h1>Par où commencer ?</h1>
        <p>
          Travaillez uniquement sur un dossier Markdown, ou reliez un coffre
          déjà chiffré sur votre instance.
        </p>
      </div>
      <small>Rien n’est créé tant que vous n’avez pas choisi.</small>
    </section>

    <section class="auth-content">
      <div class="auth-card">
        <div class="page-toolbar">
          <span class="brand-mark"
            ><span class="brand-symbol" aria-hidden="true">S</span
            >Bienvenue</span
          >
          <ThemeToggle />
        </div>
        <h2>Ouvrir un coffre</h2>
        <p class="subtitle">
          Choisissez comment accéder à vos notes. Vous pourrez changer plus
          tard.
        </p>
        <div class="welcome-choices">
          <button
            class="welcome-choice"
            type="button"
            :disabled="busy"
            aria-label="Ouvrir un coffre local"
            @click="openLocalVault"
          >
            <span class="welcome-choice-icon" aria-hidden="true">L</span>
            <span class="welcome-choice-title">Coffre local</span>
            <span class="welcome-choice-copy">
              Un dossier de fichiers Markdown sur cet appareil. Aucun compte.
            </span>
          </button>
          <button
            class="welcome-choice"
            type="button"
            aria-label="Connecter un coffre en ligne existant"
            @click="connectOnlineVault"
          >
            <span class="welcome-choice-icon" aria-hidden="true">N</span>
            <span class="welcome-choice-title">Coffre en ligne</span>
            <span class="welcome-choice-copy">
              Connexion à votre instance pour retrouver un coffre déjà créé.
            </span>
          </button>
        </div>
        <p v-if="error" class="welcome-error" role="alert">{{ error }}</p>
      </div>
    </section>
  </main>
</template>
