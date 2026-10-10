<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, nextTick, onMounted, ref } from "vue";
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
const rememberedInstanceUrl = localStorage.getItem("synapse-instance-url");
const instanceUrl = ref(
  rememberedInstanceUrl ??
    import.meta.env.VITE_SYNAPSE_INSTANCE_URL ??
    "http://127.0.0.1:3000",
);
const editingInstance = ref(rememberedInstanceUrl === null);
const instanceLabel = computed(() =>
  instanceUrl.value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, ""),
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

async function editInstance() {
  editingInstance.value = true;
  await nextTick();
  document.getElementById("login-instance")?.focus();
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
      editingInstance.value = true;
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
          Connectez-vous à votre instance ou continuez sans compte. La phrase de
          déchiffrement reste locale.
        </p>
        <div class="local-vault-option">
          <div class="local-vault-copy">
            <strong>Sans compte</strong>
            <p class="form-hint">
              Notes chiffrées sur cet appareil, jamais envoyées à un compte. Y
              passer plus tard demande un export/import.
            </p>
          </div>
          <Button
            class="local-vault-button"
            :disabled="busy"
            label="Ouvrir un coffre local"
            outlined
            severity="secondary"
            size="small"
            @click="openLocal"
          />
        </div>
        <div
          class="account-form-divider"
          role="separator"
          aria-label="ou se connecter à un compte"
        >
          <span aria-hidden="true">ou avec un compte</span>
        </div>
        <form class="form-stack" @submit.prevent="submit">
          <div v-if="!editingInstance" class="instance-summary">
            <span class="instance-summary-label">Instance</span>
            <span class="instance-summary-url" :title="instanceUrl">{{
              instanceLabel
            }}</span>
            <button type="button" @click="editInstance">Modifier</button>
          </div>
          <div v-else class="form-field">
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
          <div class="remember-option">
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
              Garde la session ouverte 30 jours. La phrase du coffre reste
              exigée, sauf si l’appareil de confiance est activé. À éviter sur
              un appareil partagé.
            </p>
          </div>
          <div v-if="error" role="alert">
            <Message severity="error" :closable="false">{{ error }}</Message>
          </div>
          <Button
            :disabled="busy"
            :loading="busy"
            label="Se connecter"
            type="submit"
          />
        </form>
        <p v-if="publicSignup" class="form-footer">
          Pas encore de compte ?
          <RouterLink to="/register">Créer un compte</RouterLink>
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.auth-card .subtitle {
  margin-bottom: 1.25rem;
}

.local-vault-option {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0.6rem 1rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-md);
  background: var(--synapse-color-surface-muted);
}

.local-vault-copy {
  display: contents;
  font-size: 0.9rem;
}

.local-vault-copy .form-hint {
  grid-row: 2;
  grid-column: 1 / -1;
}

.local-vault-option .form-hint,
.remember-option .form-hint {
  margin: 0;
}

/* PrimeVue runs unstyled and marks this variant only through data-p, which the
   shared button styles do not target: the secondary look is defined here. */
.local-vault-button {
  min-height: 2.25rem;
  padding: 0.4rem 0.8rem;
  border-color: var(--synapse-color-border);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
  box-shadow: none;
  font-size: 0.85rem;
}

.local-vault-option .local-vault-button:hover:not(:disabled) {
  border-color: var(--synapse-color-accent);
  color: var(--synapse-color-accent-strong);
  background: var(--synapse-color-surface-accent);
}

.account-form-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1.25rem 0;
  color: var(--synapse-color-text-muted);
  font-size: 0.8rem;
}

.account-form-divider::before,
.account-form-divider::after {
  flex: 1;
  border-top: 1px solid var(--synapse-color-border);
  content: "";
}

.instance-summary {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.instance-summary-label {
  color: var(--synapse-color-text-muted);
}

.instance-summary-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.instance-summary button {
  padding: 0;
  border: 0;
  color: var(--synapse-color-accent);
  background: none;
  cursor: pointer;
  font: inherit;
  font-weight: 650;
}

.instance-summary button:hover {
  text-decoration: underline;
}

.remember-option {
  display: grid;
  gap: 0.35rem;
}

.remember-option .form-hint {
  padding-left: 1.6rem;
}
</style>
