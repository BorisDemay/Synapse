<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";

import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Password from "primevue/password";

import { ThemeToggle } from "@synapse/ui";

import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref("");
const publicSignup = ref(false);

onMounted(async () => {
  publicSignup.value = await auth.fetchPublicSignup();
});

async function submit() {
  error.value = "";
  try {
    await auth.configureInstance(auth.instanceUrl);
    await auth.login(email.value, password.value);
    password.value = "";
    await router.push("/unlock");
  } catch {
    password.value = "";
    error.value = "Connexion impossible.";
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
        <h1>Vos idées, enfin à leur place.</h1>
        <p>
          Le coffre local reste sur votre disque. Connectez un compte pour
          conserver une copie chiffrée sur votre instance.
        </p>
      </div>
      <small>Chiffré localement. Auto-hébergeable. Ouvert.</small>
    </section>

    <section class="auth-content">
      <div class="auth-card">
        <div class="page-toolbar">
          <span class="brand-mark"
            ><span class="brand-symbol" aria-hidden="true">S</span
            >Connexion</span
          >
          <ThemeToggle />
        </div>
        <h2>Bon retour.</h2>
        <p class="subtitle">
          Retrouvez un coffre déjà créé sur votre instance. La phrase de
          déchiffrement reste locale.
        </p>
        <form class="form-stack" @submit.prevent="submit">
          <div class="form-field">
            <label for="login-instance">URL de l’instance</label>
            <InputText
              id="login-instance"
              v-model="auth.instanceUrl"
              autocomplete="url"
              fluid
              required
              type="url"
            />
          </div>
          <div class="form-field">
            <label for="login-email">Email</label>
            <InputText
              id="login-email"
              v-model="email"
              autocomplete="username"
              fluid
              required
              type="text"
            />
          </div>
          <div class="form-field">
            <label for="login-password">Mot de passe</label>
            <Password
              input-id="login-password"
              v-model="password"
              :feedback="false"
              fluid
              autocomplete="current-password"
              required
              toggle-mask
            />
          </div>
          <Button label="Se connecter" type="submit" />
        </form>
        <p v-if="error" role="alert">
          <Message severity="error" :closable="false">{{ error }}</Message>
        </p>
        <p v-if="publicSignup" class="form-footer">
          Pas encore de compte ?
          <RouterLink to="/register">Créer un compte</RouterLink>
        </p>
        <p class="form-footer">
          <RouterLink to="/">Choisir un coffre local</RouterLink>
        </p>
      </div>
    </section>
  </main>
</template>
