<script setup lang="ts">
import { ref } from "vue";

import ThemeToggle from "./ThemeToggle.vue";

export interface SettingsSession {
  createdAt: string;
  current: boolean;
  id: string;
}

const props = withDefaults(
  defineProps<{
    accountEmail?: string;
    deviceSupported: boolean;
    deviceTrusted: boolean;
    dailyNotePattern?: string;
    errorMessage?: string;
    exportSupported?: boolean;
    offline?: boolean;
    open: boolean;
    sessions?: SettingsSession[];
    statusMessage?: string;
    templatesPath?: string;
  }>(),
  {
    accountEmail: "",
    errorMessage: "",
    exportSupported: true,
    offline: false,
    sessions: () => [],
    statusMessage: "",
    dailyNotePattern: "Daily/YYYY-MM-DD.md",
    templatesPath: "Templates",
  },
);

const emit = defineEmits<{
  changePassphrase: [current: string, next: string];
  changePassword: [current: string, next: string];
  close: [];
  deleteAccount: [password: string];
  exportNotes: [];
  forgetDevice: [];
  lockVault: [];
  rememberDevice: [];
  revokeOtherSessions: [];
  revokeSession: [id: string];
  saveVaultPreferences: [templatesPath: string, dailyNotePattern: string];
}>();

const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const currentPassphrase = ref("");
const newPassphrase = ref("");
const confirmPassphrase = ref("");
const deletePassword = ref("");
const deleteConfirmation = ref("");
const formError = ref("");
const templatesPath = ref(props.templatesPath);
const dailyNotePattern = ref(props.dailyNotePattern);

function onBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    emit("close");
  }
}

function resetSecrets() {
  currentPassword.value = "";
  newPassword.value = "";
  confirmPassword.value = "";
  currentPassphrase.value = "";
  newPassphrase.value = "";
  confirmPassphrase.value = "";
  deletePassword.value = "";
}

function submitPassword() {
  formError.value = "";
  if (newPassword.value !== confirmPassword.value) {
    formError.value = "La confirmation du mot de passe ne correspond pas.";
    return;
  }
  emit("changePassword", currentPassword.value, newPassword.value);
  resetSecrets();
}

function submitPassphrase() {
  formError.value = "";
  if (newPassphrase.value !== confirmPassphrase.value) {
    formError.value = "La confirmation de la phrase ne correspond pas.";
    return;
  }
  emit("changePassphrase", currentPassphrase.value, newPassphrase.value);
  currentPassphrase.value = "";
  newPassphrase.value = "";
  confirmPassphrase.value = "";
}

function submitDelete() {
  formError.value = "";
  if (deleteConfirmation.value !== props.accountEmail) {
    formError.value = "Saisissez l’email du compte pour confirmer.";
    return;
  }
  emit("deleteAccount", deletePassword.value);
  resetSecrets();
  deleteConfirmation.value = "";
}

function submitVaultPreferences() {
  formError.value = "";
  if (!templatesPath.value.trim() || !dailyNotePattern.value.trim()) {
    formError.value =
      "Les chemins de modèles et de note quotidienne sont requis.";
    return;
  }
  emit(
    "saveVaultPreferences",
    templatesPath.value.trim(),
    dailyNotePattern.value.trim(),
  );
}
</script>

<template>
  <div v-if="open" class="settings-backdrop" @click="onBackdrop">
    <section
      class="settings-panel"
      role="dialog"
      aria-label="Paramètres"
      aria-modal="true"
    >
      <header class="settings-header">
        <div>
          <span class="settings-eyebrow">COMPTE</span>
          <h2>Paramètres</h2>
        </div>
        <button
          class="settings-close"
          type="button"
          aria-label="Fermer les paramètres"
          @click="emit('close')"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <p v-if="statusMessage" class="settings-status" role="status">
        {{ statusMessage }}
      </p>
      <p v-if="errorMessage || formError" class="settings-error" role="alert">
        {{ errorMessage || formError }}
      </p>

      <section class="settings-section" aria-labelledby="settings-appearance">
        <h3 id="settings-appearance">Apparence</h3>
        <p>Le thème reste sur cet appareil, hors du coffre.</p>
        <ThemeToggle />
      </section>

      <section
        v-if="deviceSupported"
        class="settings-section"
        aria-labelledby="settings-device"
      >
        <h3 id="settings-device">Cet appareil</h3>
        <p v-if="deviceTrusted">
          Cet appareil est enregistré pour déverrouiller ce coffre sans
          ressaisir la phrase. Quiconque utilise ce profil navigateur peut
          ouvrir vos notes.
        </p>
        <p v-else>
          Enregistrer cet appareil enveloppe la clé de coffre dans ce
          navigateur. La phrase reste la seule méthode de secours.
        </p>
        <button
          v-if="deviceTrusted"
          class="settings-danger"
          type="button"
          aria-label="Oublier cet appareil"
          @click="emit('forgetDevice')"
        >
          Oublier cet appareil
        </button>
        <button
          v-else
          class="settings-action"
          type="button"
          aria-label="Rester déverrouillé sur ce navigateur"
          @click="emit('rememberDevice')"
        >
          Rester déverrouillé sur ce navigateur
        </button>
      </section>

      <section class="settings-section" aria-labelledby="settings-vault">
        <h3 id="settings-vault">Coffre</h3>
        <p>
          Verrouiller retire la clé de la mémoire. La phrase sera demandée pour
          cette session, même si l’appareil est enregistré.
        </p>
        <button
          class="settings-action"
          type="button"
          aria-label="Verrouiller le coffre"
          @click="emit('lockVault')"
        >
          Verrouiller le coffre
        </button>
        <template v-if="exportSupported">
          <p>
            L’export produit un fichier Markdown local. Rien n’est envoyé au
            serveur.
          </p>
          <button
            class="settings-action"
            type="button"
            aria-label="Exporter les notes en Markdown"
            @click="emit('exportNotes')"
          >
            Exporter les notes en Markdown
          </button>
        </template>
        <form
          class="settings-form"
          data-form="vault-preferences"
          @submit.prevent="submitVaultPreferences"
        >
          <h4>Modèles et note quotidienne</h4>
          <p>
            Ces préférences sont chiffrées localement avec le coffre et ne sont
            jamais envoyées au serveur.
          </p>
          <label class="settings-field">
            Dossier des modèles
            <input
              v-model="templatesPath"
              name="templates-path"
              autocomplete="off"
              required
            />
          </label>
          <label class="settings-field">
            Chemin quotidien (`YYYY`, `MM`, `DD`)
            <input
              v-model="dailyNotePattern"
              name="daily-note-pattern"
              autocomplete="off"
              required
            />
          </label>
          <button class="settings-action" type="submit">
            Enregistrer les préférences du coffre
          </button>
        </form>
        <form class="settings-form" @submit.prevent="submitPassphrase">
          <p>
            La phrase de déchiffrement n’est jamais envoyée au serveur. Elle est
            distincte du mot de passe de connexion.
          </p>
          <label class="settings-field">
            Phrase actuelle
            <input
              v-model="currentPassphrase"
              name="current-passphrase"
              type="password"
              autocomplete="off"
              required
            />
          </label>
          <label class="settings-field">
            Nouvelle phrase
            <input
              v-model="newPassphrase"
              name="new-passphrase"
              type="password"
              autocomplete="off"
              required
            />
          </label>
          <label class="settings-field">
            Confirmer la nouvelle phrase
            <input
              v-model="confirmPassphrase"
              name="confirm-passphrase"
              type="password"
              autocomplete="off"
              required
            />
          </label>
          <button class="settings-action" type="submit">
            Changer la phrase de déchiffrement
          </button>
        </form>
      </section>

      <section
        v-if="!offline"
        class="settings-section"
        aria-labelledby="settings-account"
      >
        <h3 id="settings-account">Compte</h3>
        <form class="settings-form" @submit.prevent="submitPassword">
          <p>Le mot de passe sert uniquement à ouvrir une session serveur.</p>
          <label class="settings-field">
            Mot de passe actuel
            <input
              v-model="currentPassword"
              name="current-password"
              type="password"
              autocomplete="current-password"
              required
            />
          </label>
          <label class="settings-field">
            Nouveau mot de passe
            <input
              v-model="newPassword"
              name="new-password"
              type="password"
              autocomplete="new-password"
              minlength="12"
              required
            />
          </label>
          <label class="settings-field">
            Confirmer le nouveau mot de passe
            <input
              v-model="confirmPassword"
              name="confirm-password"
              type="password"
              autocomplete="new-password"
              minlength="12"
              required
            />
          </label>
          <button class="settings-action" type="submit">
            Changer le mot de passe
          </button>
        </form>
      </section>

      <section
        v-if="!offline"
        class="settings-section"
        aria-labelledby="settings-sessions"
      >
        <h3 id="settings-sessions">Sessions</h3>
        <p>Révoquer une session la déconnecte immédiatement.</p>
        <ul class="settings-sessions" aria-label="Sessions actives">
          <li v-for="session in sessions" :key="session.id">
            <div>
              <strong>{{
                session.current ? "Cette session" : "Autre session"
              }}</strong>
              <span>{{ session.createdAt }}</span>
            </div>
            <button
              v-if="!session.current"
              class="settings-danger"
              type="button"
              :aria-label="`Révoquer la session ${session.id}`"
              @click="emit('revokeSession', session.id)"
            >
              Révoquer
            </button>
          </li>
        </ul>
        <button
          class="settings-action"
          type="button"
          aria-label="Révoquer les autres sessions"
          @click="emit('revokeOtherSessions')"
        >
          Révoquer les autres sessions
        </button>
      </section>

      <section
        v-if="!offline && accountEmail"
        class="settings-section"
        aria-labelledby="settings-delete"
      >
        <h3 id="settings-delete">Supprimer le compte</h3>
        <p>
          Irréversible. Les coffres serveur et les sessions sont effacés. Les
          notes déjà exportées restent sur votre appareil.
        </p>
        <form class="settings-form" @submit.prevent="submitDelete">
          <label class="settings-field">
            Tapez {{ accountEmail || "votre email" }} pour confirmer
            <input
              v-model="deleteConfirmation"
              name="delete-confirmation"
              type="text"
              autocomplete="off"
              required
            />
          </label>
          <label class="settings-field">
            Mot de passe du compte
            <input
              v-model="deletePassword"
              name="delete-password"
              type="password"
              autocomplete="off"
              required
            />
          </label>
          <button class="settings-danger" type="submit">
            Supprimer définitivement le compte
          </button>
        </form>
      </section>
    </section>
  </div>
</template>

<style scoped>
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 1.25rem;
  background: rgb(15 23 42 / 42%);
}

.settings-panel {
  display: grid;
  gap: 1.35rem;
  width: min(32rem, 100%);
  max-height: min(42rem, calc(100vh - 2.5rem));
  overflow: auto;
  padding: 1.35rem 1.4rem 1.5rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-lg);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
  box-shadow: var(--synapse-shadow-md);
}

.settings-header,
.settings-section,
.settings-form {
  display: grid;
  gap: 0.45rem;
}

.settings-header {
  grid-template-columns: 1fr auto;
  align-items: start;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid var(--synapse-color-border);
}

.settings-header h2,
.settings-section h3 {
  margin: 0.15rem 0 0;
}

.settings-header h2 {
  font-size: 1.35rem;
  letter-spacing: -0.04em;
}

.settings-section h3 {
  font-size: 0.95rem;
}

.settings-eyebrow {
  color: var(--synapse-color-text-muted);
  font-size: 0.66rem;
  font-weight: 750;
  letter-spacing: 0.14em;
}

.settings-section p,
.settings-status,
.settings-error {
  margin: 0 0 0.35rem;
  font-size: 0.88rem;
  line-height: 1.45;
}

.settings-section p {
  color: var(--synapse-color-text-muted);
}

.settings-status {
  color: var(--synapse-color-success);
}

.settings-error {
  color: var(--synapse-color-danger);
}

.settings-close,
.settings-action,
.settings-danger {
  font: inherit;
  cursor: pointer;
}

.settings-close {
  display: grid;
  place-items: center;
  width: 2.2rem;
  height: 2.2rem;
  border: 0;
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: transparent;
  font-size: 1.4rem;
  line-height: 1;
}

.settings-close:hover {
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-muted);
}

.settings-action,
.settings-danger {
  justify-self: start;
  min-height: 2.5rem;
  padding: 0.55rem 0.85rem;
  border-radius: var(--synapse-radius-sm);
  font-weight: 700;
}

.settings-action {
  border: 1px solid var(--synapse-color-border);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface);
}

.settings-action:hover {
  border-color: var(--synapse-color-accent);
  background: var(--synapse-color-surface-accent);
}

.settings-danger {
  border: 1px solid
    color-mix(
      in srgb,
      var(--synapse-color-danger) 35%,
      var(--synapse-color-border)
    );
  color: var(--synapse-color-danger);
  background: color-mix(in srgb, var(--synapse-color-danger) 8%, transparent);
}

.settings-danger:hover {
  background: color-mix(in srgb, var(--synapse-color-danger) 14%, transparent);
}

.settings-field {
  display: grid;
  gap: 0.3rem;
  color: var(--synapse-color-text);
  font-size: 0.82rem;
  font-weight: 650;
}

.settings-field input {
  min-height: 2.5rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface);
  font: inherit;
  font-weight: 500;
}

.settings-sessions {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.settings-sessions li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
}

.settings-sessions div {
  display: grid;
  gap: 0.15rem;
}

.settings-sessions span {
  color: var(--synapse-color-text-muted);
  font-size: 0.78rem;
}
</style>
