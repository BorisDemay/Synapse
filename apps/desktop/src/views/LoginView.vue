<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";

import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Password from "primevue/password";

import { ThemeToggle } from "@synapse/ui";

import { useAuthStore, AuthError } from "../../../web/src/stores/auth";
import { useVaultStore } from "../../../web/src/stores/vault";

const auth = useAuthStore();
const vault = useVaultStore();
const router = useRouter();
const instanceUrl = ref(
  localStorage.getItem("synapse-instance-url") ??
    import.meta.env.VITE_SYNAPSE_INSTANCE_URL ??
    "http://127.0.0.1:3000",
);
const email = ref("");
const password = ref("");
const rememberDevice = ref(false);
const busy = ref(false);
const error = ref("");
const publicSignup = ref(false);

onMounted(async () => {
  await configureInstance().catch(() => undefined);
  publicSignup.value = await auth.fetchPublicSignup();
});

async function configureInstance() {
  const url = instanceUrl.value.trim();
  await invoke("set_instance_url", { url });
  localStorage.setItem("synapse-instance-url", url);
}

async function openLocal() {
  if (busy.value) return;
  error.value = "";
  busy.value = true;
  try {
    await auth.enterLocalMode();
    await router.push("/unlock");
  } catch {
    error.value = "Impossible d’ouvrir le profil local.";
  } finally {
    busy.value = false;
  }
}

async function submit() {
  if (busy.value) return;
  error.value = "";
  busy.value = true;
  try {
    await configureInstance();
    await auth.login(email.value, password.value, {
      rememberDevice: rememberDevice.value,
    });
    password.value = "";
    if (await vault.tryUnlockFromTrustedDevice()) {
      await router.push("/vault");
      return;
    }
    await router.push("/unlock");
  } catch (cause) {
    password.value = "";
    if (cause instanceof AuthError) {
      if (cause.status === 403) {
        error.value =
          "Compte non activé. Ouvrez le lien d’activation envoyé par email (vérifiez vos spams), puis réessayez.";
      } else if (cause.status === 401) {
        error.value = "Email ou mot de passe incorrect.";
      } else {
        error.value = "Connexion impossible.";
      }
    } else {
      error.value =
        "Serveur injoignable. Vérifiez votre connexion ou l’URL de l’instance, puis réessayez.";
    }
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
        <div class="local-vault-option">
          <p class="form-hint">
            Pas de compte, ou notes à garder sur cet appareil ?
          </p>
          <Button
            :disabled="busy"
            label="Utiliser un coffre local sans compte"
            severity="secondary"
            @click="openLocal"
          />
          <p class="form-hint">
            Le coffre local reste chiffré sur cet appareil. Ses notes ne sont
            jamais envoyées automatiquement à un compte : passer plus tard à un
            compte exige un export/import explicite.
          </p>
        </div>
        <div
          class="account-form-divider"
          role="separator"
          aria-label="ou se connecter à un compte"
        ></div>
        <form class="form-stack" @submit.prevent="submit">
          <div class="form-field">
            <label for="login-instance">URL de l’instance</label>
            <InputText
              id="login-instance"
              v-model="instanceUrl"
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
              inputmode="email"
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
          <label class="trusted-device-option" for="login-remember-device">
            <input
              id="login-remember-device"
              v-model="rememberDevice"
              type="checkbox"
              aria-describedby="login-remember-hint"
            />
            <span>Se souvenir de cet appareil</span>
          </label>
          <p id="login-remember-hint" class="form-hint">
            Garde la session de compte ouverte sur cet appareil (30 jours) : le
            mot de passe de compte sera demandé moins souvent. Ce n’est pas
            l’appareil de confiance : la phrase du coffre reste exigée, sauf si
            vous avez activé l’appareil de confiance après un déverrouillage.
            N’activez pas cette option sur un appareil partagé.
          </p>
          <Button
            :disabled="busy"
            :loading="busy"
            label="Se connecter"
            type="submit"
          />
        </form>
        <p v-if="error" role="alert">
          <Message severity="error" :closable="false">{{ error }}</Message>
        </p>
        <p v-if="publicSignup" class="form-footer">
          Pas encore de compte ?
          <RouterLink to="/register">Créer un compte</RouterLink>
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.local-vault-option {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.account-form-divider {
  border-top: 1px solid var(--synapse-border, currentColor);
  margin-bottom: 1rem;
  opacity: 0.25;
}
</style>
