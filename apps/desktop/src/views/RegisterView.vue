<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Password from "primevue/password";

import { ThemeToggle } from "@synapse/ui";

import { useAuthStore } from "../../../web/src/stores/auth";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const email = ref("");
const password = ref("");
const instanceUrl = ref(
  localStorage.getItem("synapse-instance-url") ??
    import.meta.env.VITE_SYNAPSE_INSTANCE_URL ??
    "http://127.0.0.1:3000",
);
const invitationToken = ref(
  typeof route.query.invitation === "string" ? route.query.invitation : "",
);
const error = ref("");
const publicSignup = ref(false);
const statusLoaded = ref(false);

const showForm = computed(
  () => publicSignup.value || invitationToken.value.trim().length > 0,
);

onMounted(async () => {
  await configureInstance().catch(() => undefined);
  publicSignup.value = await auth.fetchPublicSignup();
  statusLoaded.value = true;
});

async function configureInstance() {
  const url = instanceUrl.value.trim();
  await invoke("set_instance_url", { url });
  localStorage.setItem("synapse-instance-url", url);
}

async function submit() {
  error.value = "";
  try {
    await configureInstance();
    await auth.register({
      email: email.value,
      invitationToken: invitationToken.value.trim() || undefined,
      password: password.value,
    });
    password.value = "";
    await router.push("/unlock");
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
          Créez un compte pour conserver une copie chiffrée de vos notes sur
          votre instance. Les fichiers Markdown restent aussi sur votre disque.
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
        <template v-if="statusLoaded && showForm">
          <h2>Commencez votre espace.</h2>
          <p class="subtitle">Un compte, puis une phrase pour la sync.</p>
          <form class="form-stack" @submit.prevent="submit">
            <div class="form-field">
              <label for="register-instance">URL de l’instance</label>
              <InputText
                id="register-instance"
                v-model="instanceUrl"
                autocomplete="url"
                fluid
                required
                type="url"
              />
            </div>
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
