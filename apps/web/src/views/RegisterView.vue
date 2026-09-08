<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";

import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Password from "primevue/password";

import { ThemeToggle } from "@synapse/ui";

import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const route = useRoute();
const email = ref("");
const password = ref("");
const invitationToken = ref(
  typeof route.query.invitation === "string" ? route.query.invitation : "",
);
const error = ref("");
const registered = ref(false);
const publicSignup = ref(false);
const statusLoaded = ref(false);

const showForm = computed(
  () => publicSignup.value || invitationToken.value.trim().length > 0,
);

onMounted(async () => {
  publicSignup.value = await auth.fetchPublicSignup();
  statusLoaded.value = true;
});

async function submit() {
  error.value = "";
  try {
    await auth.register({
      email: email.value,
      invitationToken: invitationToken.value.trim() || undefined,
      password: password.value,
    });
    password.value = "";
    invitationToken.value = "";
    registered.value = true;
  } catch {
    password.value = "";
    error.value = "Inscription impossible.";
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
        <h1>Un endroit calme pour penser.</h1>
        <p>
          Créez un espace privé où vos notes restent accessibles, exportables et
          chiffrées avant toute synchronisation.
        </p>
      </div>
      <small>Vos contenus restent sous votre contrôle.</small>
    </section>

    <section class="auth-content">
      <div class="auth-card">
        <div class="page-toolbar">
          <span class="brand-mark"
            ><span class="brand-symbol" aria-hidden="true">S</span
            >Inscription</span
          >
          <ThemeToggle />
        </div>
        <template v-if="registered">
          <h2>Consultez votre messagerie.</h2>
          <p role="status">
            Un lien d’activation a été envoyé. Activez votre compte, puis
            connectez-vous.
          </p>
        </template>
        <template v-else-if="statusLoaded && showForm">
          <h2>Commencez votre espace.</h2>
          <p class="subtitle">
            Un compte, puis un coffre déverrouillé localement.
          </p>
          <form class="form-stack" @submit.prevent="submit">
            <div class="form-field">
              <label for="register-email">Email</label>
              <InputText
                id="register-email"
                v-model="email"
                autocomplete="username"
                fluid
                required
                type="email"
              />
            </div>
            <div class="form-field">
              <label for="register-password">Mot de passe</label>
              <Password
                input-id="register-password"
                v-model="password"
                :feedback="false"
                fluid
                autocomplete="new-password"
                required
                toggle-mask
              />
            </div>
            <div v-if="!publicSignup" class="form-field">
              <label for="register-invitation">Jeton d’invitation</label>
              <InputText
                id="register-invitation"
                v-model="invitationToken"
                autocomplete="off"
                fluid
              />
            </div>
            <Button label="S’inscrire" type="submit" />
          </form>
          <p v-if="error" role="alert">
            <Message severity="error" :closable="false">{{ error }}</Message>
          </p>
        </template>
        <template v-else-if="statusLoaded">
          <h2>Inscription fermée.</h2>
          <p class="subtitle" role="status">
            L’inscription n’est pas disponible sur cette instance.
          </p>
        </template>
        <p class="form-footer">
          Déjà un compte ?
          <RouterLink to="/login">Se connecter</RouterLink>
        </p>
      </div>
    </section>
  </main>
</template>
