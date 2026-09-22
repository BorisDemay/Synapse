<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import { DialogFocusController } from "../dialog-focus";
import {
  PANEL_WIDTH_BOUNDS,
  usePanelLayout,
  type PanelId,
} from "../panel-resize";
import { useSidebarLayout } from "../sidebar-layout";
import { useTheme, type ThemePreference } from "../theme";

export interface SettingsSession {
  createdAt: string;
  current: boolean;
  id: string;
}

export interface SettingsUser {
  activated: boolean;
  createdAt: string;
  email: string;
  isAdmin: boolean;
}

type SettingsCategoryId =
  | "appearance"
  | "vault"
  | "device"
  | "account"
  | "users";

interface SettingsCategory {
  id: SettingsCategoryId;
  label: string;
}

const props = withDefaults(
  defineProps<{
    accountEmail?: string;
    admin?: boolean;
    deviceSupported: boolean;
    deviceTrusted: boolean;
    errorMessage?: string;
    exportSupported?: boolean;
    offline?: boolean;
    open: boolean;
    sessions?: SettingsSession[];
    users?: SettingsUser[];
    invitationLink?: string;
    statusMessage?: string;
    templatesPath?: string;
  }>(),
  {
    accountEmail: "",
    errorMessage: "",
    exportSupported: true,
    offline: false,
    sessions: () => [],
    users: () => [],
    invitationLink: "",
    statusMessage: "",
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
  saveVaultPreferences: [templatesPath: string];
  createInvitation: [email: string];
  openAdmin: [];
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
const invitationEmail = ref("");
const dialogElement = ref<HTMLElement>();
const statusElement = ref<HTMLParagraphElement>();
const errorElement = ref<HTMLParagraphElement>();
type PendingAction = "" | "password" | "passphrase" | "delete";
const pendingAction = ref<PendingAction>("");

function clearTransientState() {
  resetSecrets();
  deleteConfirmation.value = "";
  formError.value = "";
  pendingAction.value = "";
}

const dialogFocus = new DialogFocusController({
  getContainer: () => dialogElement.value ?? null,
  onEscape: () => emit("close"),
});
onBeforeUnmount(() => {
  dialogFocus.detach();
  clearTransientState();
});

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await nextTick();
      if (props.open) {
        dialogFocus.attach();
      }
      return;
    }
    dialogFocus.detach();
    // Aucun secret ne survit à la fermeture du panneau.
    clearTransientState();
  },
  { immediate: true },
);

// Le retour (succès ou erreur) doit rester visible et annoncé même si
// l’utilisateur a déroulé la section concernée : on amène le focus dessus.
watch(
  () => [props.statusMessage, props.errorMessage, formError.value] as const,
  async ([statusMessage, errorMessage, formErrorValue]) => {
    if (!props.open) {
      return;
    }
    const message = errorMessage || formErrorValue || statusMessage;
    if (!message) {
      return;
    }
    await nextTick();
    (errorMessage || formErrorValue
      ? errorElement.value
      : statusElement.value
    )?.focus();
  },
);

// Une réponse du parent (succès ou erreur) clôt l’attente de la tentative.
watch(
  () => [props.errorMessage, props.statusMessage] as const,
  ([errorMessage, statusMessage]) => {
    if (errorMessage || statusMessage) {
      pendingAction.value = "";
    }
  },
);

const { preference, setPreference } = useTheme();
const { collapsed, compact, setCollapsed, setCompact } = useSidebarLayout();
const panelLayout = usePanelLayout();

const themeChoice = computed({
  get: () => preference.value,
  set: (value: ThemePreference) => setPreference(value),
});
const collapsedChoice = computed({
  get: () => collapsed.value,
  set: (value: boolean) => setCollapsed(value),
});
const compactChoice = computed({
  get: () => compact.value,
  set: (value: boolean) => setCompact(value),
});

const hasSessions = computed(() => props.sessions.length > 0);
const showDeviceCategory = computed(
  () => props.deviceSupported || hasSessions.value,
);

const categories = computed<SettingsCategory[]>(() => {
  const items: SettingsCategory[] = [
    { id: "appearance", label: "Apparence" },
    { id: "vault", label: "Coffre" },
  ];
  if (showDeviceCategory.value) {
    items.push({ id: "device", label: "Appareil" });
  }
  if (!props.offline) {
    items.push({ id: "account", label: "Compte" });
  }
  if (props.admin && !props.offline) {
    items.push({ id: "users", label: "Utilisateurs" });
  }
  return items;
});

const activeCategory = ref<SettingsCategoryId>("appearance");

watch(
  // Comparaison par identifiants stables : le calculé renvoie un nouveau
  // tableau à chaque évaluation, une comparaison par référence déclencherait
  // donc un reset parasite d’activeCategory sous charge.
  () => categories.value.map((category) => category.id).join(","),
  () => {
    if (
      !categories.value.some((category) => category.id === activeCategory.value)
    ) {
      activeCategory.value = categories.value[0]?.id ?? "appearance";
    }
  },
  { immediate: true },
);

function selectCategory(id: SettingsCategoryId) {
  // Les erreurs de formulaire sont propres à une catégorie.
  formError.value = "";
  pendingAction.value = "";
  activeCategory.value = id;
}

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
  pendingAction.value = "password";
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
  pendingAction.value = "passphrase";
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
  pendingAction.value = "delete";
}

function resetAppearance() {
  setPreference("system");
  setCollapsed(false);
  setCompact(false);
  for (const panel of Object.keys(PANEL_WIDTH_BOUNDS) as PanelId[]) {
    panelLayout.resetPanelWidth(panel);
  }
}

function submitVaultPreferences() {
  formError.value = "";
  if (!templatesPath.value.trim()) {
    formError.value = "Le dossier des modèles est requis.";
    return;
  }
  emit("saveVaultPreferences", templatesPath.value.trim());
}

function submitInvitation() {
  const email = invitationEmail.value.trim();
  if (!email) {
    formError.value = "L’adresse e-mail est requise.";
    return;
  }
  formError.value = "";
  emit("createInvitation", email);
  invitationEmail.value = "";
}

function selectInvitationLink(event: Event) {
  (event.target as HTMLInputElement).select();
}
</script>

<template>
  <div v-if="open" class="settings-backdrop" @click="onBackdrop">
    <section
      ref="dialogElement"
      class="settings-panel settings-panel-wide settings-panel-fixed"
      role="dialog"
      aria-label="Paramètres"
      aria-modal="true"
    >
      <header class="settings-header">
        <div>
          <span class="settings-eyebrow">PARAMÈTRES</span>
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

      <div class="settings-body settings-body-fill">
        <nav
          class="settings-nav settings-nav-scroll"
          aria-label="Catégories de paramètres"
        >
          <ul class="settings-nav-list">
            <li v-for="category in categories" :key="category.id">
              <button
                class="settings-nav-item"
                type="button"
                :data-settings-category="category.label"
                :aria-current="
                  activeCategory === category.id ? 'page' : undefined
                "
                @click="selectCategory(category.id)"
              >
                {{ category.label }}
              </button>
            </li>
          </ul>
        </nav>

        <div
          class="settings-content settings-content-scroll settings-content-compact"
          data-test="settings-content"
        >
          <p
            v-if="statusMessage"
            ref="statusElement"
            class="settings-status"
            role="status"
            tabindex="-1"
          >
            {{ statusMessage }}
          </p>
          <p
            v-if="errorMessage || formError"
            ref="errorElement"
            class="settings-error"
            role="alert"
            tabindex="-1"
          >
            {{ errorMessage || formError }}
          </p>

          <section
            v-if="activeCategory === 'appearance'"
            class="settings-section"
            aria-labelledby="settings-appearance"
          >
            <h3 id="settings-appearance" class="settings-section-title">
              Apparence
            </h3>
            <p>
              Ces préférences restent sur cet appareil, hors du coffre. Elles ne
              sont jamais envoyées au serveur.
            </p>

            <div class="settings-subsection">
              <h4 id="settings-appearance-theme">Thème</h4>
              <p>
                Clair et sombre s’appliquent tout de suite. Système suit le
                thème de l’appareil.
              </p>
              <fieldset
                class="settings-choice-group"
                data-test="appearance-theme"
                aria-labelledby="settings-appearance-theme"
              >
                <legend class="visually-hidden">Thème de l’interface</legend>
                <label class="settings-choice">
                  <input
                    v-model="themeChoice"
                    type="radio"
                    name="appearance-theme"
                    value="light"
                  />
                  Clair
                </label>
                <label class="settings-choice">
                  <input
                    v-model="themeChoice"
                    type="radio"
                    name="appearance-theme"
                    value="dark"
                  />
                  Sombre
                </label>
                <label class="settings-choice">
                  <input
                    v-model="themeChoice"
                    type="radio"
                    name="appearance-theme"
                    value="system"
                  />
                  Système
                </label>
              </fieldset>
            </div>

            <div class="settings-subsection">
              <h4 id="settings-appearance-sidebar">Barre latérale</h4>
              <p>
                Mêmes réglages que l’explorateur : mini-rail et densité
                compacte, déjà persistés sur cet appareil.
              </p>
              <label
                class="settings-switch"
                data-test="appearance-sidebar-collapsed"
              >
                <span>
                  <strong>Mini-rail</strong>
                  <span class="settings-switch-hint">
                    Réduit la navigation aux icônes.
                  </span>
                </span>
                <input
                  v-model="collapsedChoice"
                  :aria-checked="collapsed"
                  aria-label="Réduire la barre latérale en mini-rail"
                  role="switch"
                  type="checkbox"
                />
              </label>
              <label
                class="settings-switch"
                data-test="appearance-sidebar-compact"
              >
                <span>
                  <strong>Mode compact</strong>
                  <span class="settings-switch-hint">
                    Masque les titres de section et resserre l’explorateur.
                  </span>
                </span>
                <input
                  v-model="compactChoice"
                  :aria-checked="compact"
                  aria-label="Activer le mode compact de l’explorateur"
                  role="switch"
                  type="checkbox"
                />
              </label>
            </div>

            <div class="settings-subsection">
              <h4 id="settings-appearance-reset">Réinitialiser</h4>
              <p>
                Remet le thème, la barre latérale et les largeurs de panneaux de
                cet appareil.
              </p>
              <button
                class="settings-action"
                type="button"
                data-test="appearance-reset"
                aria-label="Réinitialiser l’apparence"
                @click="resetAppearance"
              >
                Réinitialiser l’apparence
              </button>
            </div>
          </section>

          <template v-if="activeCategory === 'device' && showDeviceCategory">
            <section
              v-if="deviceSupported"
              class="settings-section"
              aria-labelledby="settings-device"
            >
              <h3 id="settings-device" class="settings-section-title">
                Cet appareil
              </h3>
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

            <section
              v-if="hasSessions && !offline"
              class="settings-section"
              aria-labelledby="settings-sessions"
            >
              <h3 id="settings-sessions" class="settings-section-title">
                Sessions
              </h3>
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
          </template>

          <section
            v-if="activeCategory === 'vault'"
            class="settings-section"
            aria-labelledby="settings-vault"
          >
            <h3 id="settings-vault" class="settings-section-title">Coffre</h3>
            <p>
              Verrouiller retire la clé de la mémoire. La phrase sera demandée
              pour cette session, même si l’appareil est enregistré.
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
              <h4>Modèles</h4>
              <p>
                Ces préférences sont chiffrées localement avec le coffre et ne
                sont jamais envoyées au serveur.
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
              <button class="settings-action" type="submit">
                Enregistrer les préférences du coffre
              </button>
            </form>
            <form
              class="settings-form"
              data-form="vault-passphrase"
              @submit.prevent="submitPassphrase"
            >
              <p>
                La phrase de déchiffrement n’est jamais envoyée au serveur. Elle
                est distincte du mot de passe de connexion.
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
              <p
                v-if="pendingAction === 'passphrase'"
                class="settings-pending"
                data-test="settings-pending"
                role="status"
              >
                Demande envoyée. En cas d’échec, saisissez à nouveau votre
                phrase.
              </p>
            </form>
          </section>

          <template v-if="activeCategory === 'account' && !offline">
            <section
              class="settings-section"
              aria-labelledby="settings-account"
            >
              <h3 id="settings-account" class="settings-section-title">
                Compte
              </h3>
              <form
                class="settings-form"
                data-form="account-password"
                @submit.prevent="submitPassword"
              >
                <p>
                  Le mot de passe sert uniquement à ouvrir une session serveur.
                </p>
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
                <p
                  v-if="pendingAction === 'password'"
                  class="settings-pending"
                  data-test="settings-pending"
                  role="status"
                >
                  Demande envoyée. En cas d’échec, saisissez à nouveau vos
                  informations.
                </p>
              </form>
            </section>

            <section
              v-if="accountEmail"
              class="settings-section"
              aria-labelledby="settings-delete"
            >
              <h3 id="settings-delete" class="settings-section-title">
                Supprimer le compte
              </h3>
              <p>
                Irréversible. Les coffres serveur et les sessions sont effacés.
                Les notes déjà exportées restent sur votre appareil.
              </p>
              <form
                class="settings-form"
                data-form="account-delete"
                @submit.prevent="submitDelete"
              >
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
                <p
                  v-if="pendingAction === 'delete'"
                  class="settings-pending"
                  data-test="settings-pending"
                  role="status"
                >
                  Demande envoyée.
                </p>
              </form>
            </section>
          </template>

          <section
            v-if="activeCategory === 'users' && admin && !offline"
            class="settings-section"
            aria-labelledby="settings-users"
          >
            <h3 id="settings-users" class="settings-section-title">
              Utilisateurs
            </h3>
            <p>
              Seuls les administrateurs peuvent voir cette section et créer des
              invitations. Les liens expirent après 24 heures.
            </p>
            <button
              class="settings-action"
              type="button"
              @click="emit('openAdmin')"
            >
              Ouvrir la console d’administration
            </button>
            <form
              class="settings-form"
              data-form="user-invitation"
              @submit.prevent="submitInvitation"
            >
              <label class="settings-field">
                Adresse e-mail à inviter
                <input
                  v-model="invitationEmail"
                  name="invitation-email"
                  type="email"
                  autocomplete="email"
                  required
                />
              </label>
              <button class="settings-action" type="submit">
                Générer un lien d’invitation
              </button>
            </form>
            <div
              v-if="invitationLink"
              class="settings-invitation"
              role="status"
            >
              <label class="settings-field">
                Lien à transmettre
                <input
                  :value="invitationLink"
                  readonly
                  type="text"
                  @focus="selectInvitationLink"
                />
              </label>
              <p>
                Ce lien contient le jeton secret. Il ne sera plus affiché après
                fermeture des paramètres.
              </p>
            </div>
            <ul
              class="settings-sessions"
              aria-label="Utilisateurs de l’instance"
            >
              <li v-for="user in users" :key="user.email">
                <div>
                  <strong>{{ user.email }}</strong>
                  <span
                    >{{ user.isAdmin ? "Administrateur" : "Utilisateur" }} ·
                    {{
                      user.activated ? "Activé" : "En attente d’activation"
                    }}</span
                  >
                </div>
              </li>
            </ul>
          </section>
        </div>
      </div>
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
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0;
  width: min(32rem, 100%);
  overflow: hidden;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-lg);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-raised);
  box-shadow: var(--synapse-shadow-md);
}

.settings-panel-fixed {
  height: min(40rem, calc(100vh - 4rem));
  max-height: min(40rem, calc(100vh - 4rem));
}

.settings-panel-wide {
  width: min(56rem, 100%);
}

.settings-body-fill {
  min-height: 0;
  overflow: hidden;
}

.settings-body {
  display: grid;
  grid-template-columns: minmax(10.5rem, 12rem) minmax(0, 1fr);
  border-top: 1px solid var(--synapse-color-border);
}

.settings-nav-scroll {
  min-height: 0;
  overflow-y: auto;
}

.settings-nav {
  padding: 0.85rem 0.65rem;
  border-right: 1px solid var(--synapse-color-border);
  background: var(--synapse-color-surface);
}

.settings-nav-list {
  display: grid;
  gap: 0.2rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.settings-nav-item {
  width: 100%;
  min-height: 2.35rem;
  padding: 0.45rem 0.65rem;
  border: 0;
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text-muted);
  background: transparent;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 650;
  text-align: left;
  cursor: pointer;
}

.settings-nav-item:hover {
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-muted);
}

.settings-nav-item[aria-current="page"] {
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface-accent);
}

.settings-content-scroll {
  min-height: 0;
  overflow-y: auto;
}

.settings-content-compact {
  align-items: start;
  align-content: start;
}

.settings-content {
  display: grid;
  gap: 1.35rem;
  padding: 1.1rem 1.35rem 1.5rem;
}

.settings-header,
.settings-section,
.settings-form {
  display: grid;
  gap: 0.45rem;
  align-items: start;
  align-content: start;
}

.settings-section,
.settings-form {
  width: 100%;
}

.settings-header {
  grid-template-columns: 1fr auto;
  align-items: start;
  padding: 1.1rem 1.35rem 0.85rem;
}

.settings-header h2 {
  margin: 0.15rem 0 0;
  font-size: 1.35rem;
  letter-spacing: -0.04em;
}

.settings-section-title {
  margin: 0 0 0.5rem;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
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

.settings-subsection {
  display: grid;
  gap: 0.4rem;
  padding-top: 0.45rem;
}

.settings-subsection h4 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.settings-choice-group {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  border: 0;
}

.settings-choice {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2.2rem;
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface);
  font-size: 0.82rem;
  font-weight: 650;
  cursor: pointer;
}

.settings-choice:has(input:checked),
.settings-choice:has(input:focus-visible) {
  border-color: var(--synapse-color-accent);
  background: var(--synapse-color-surface-accent);
}

.settings-choice input {
  margin: 0;
}

.settings-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.45rem 0.55rem;
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-sm);
  color: var(--synapse-color-text);
  background: var(--synapse-color-surface);
  font-size: 0.82rem;
  cursor: pointer;
}

.settings-switch strong {
  font-weight: 700;
}

.settings-switch-hint {
  display: block;
  color: var(--synapse-color-text-muted);
  font-size: 0.78rem;
  font-weight: 500;
  line-height: 1.35;
}

.settings-switch input {
  appearance: none;
  width: 2.5rem;
  height: 1.4rem;
  flex: 0 0 auto;
  border: 0;
  border-radius: 999px;
  background: var(--synapse-color-border);
  cursor: pointer;
}

.settings-switch input:focus-visible {
  outline: 2px solid var(--synapse-color-accent);
  outline-offset: 2px;
}

.settings-switch input::after {
  content: "";
  display: block;
  width: 1.1rem;
  height: 1.1rem;
  margin: 0.15rem;
  border-radius: 999px;
  background: var(--synapse-color-surface-raised);
  box-shadow: var(--synapse-shadow-sm);
}

.settings-switch input:checked {
  background: var(--synapse-color-accent);
}

.settings-switch input:checked::after {
  transform: translateX(1.1rem);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.settings-status {
  color: var(--synapse-color-success);
}

.settings-error {
  color: var(--synapse-color-danger);
}

.settings-status:focus-visible,
.settings-error:focus-visible {
  outline: 2px solid var(--synapse-color-accent);
  outline-offset: 2px;
}

.settings-pending {
  margin: 0;
  color: var(--synapse-color-text-muted);
  font-size: 0.8rem;
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
  align-self: start;
  width: auto;
  max-width: max-content;
  height: auto;
  flex: 0 0 auto;
  min-height: 2.5rem;
  padding: 0.55rem 0.85rem;
  border-radius: var(--synapse-radius-sm);
  font-weight: 700;
}

.settings-section :deep(.theme-toggle),
.settings-form :deep(.theme-toggle),
.settings-section :deep(.p-button),
.settings-form :deep(.p-button),
.settings-section :deep(button[data-pc-name="button"]),
.settings-form :deep(button[data-pc-name="button"]) {
  justify-self: start;
  align-self: start;
  width: auto;
  max-width: max-content;
  height: auto;
  flex: 0 0 auto;
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

@media (max-width: 860px) {
  .settings-body {
    grid-template-columns: minmax(8.5rem, 9.5rem) minmax(0, 1fr);
  }

  .settings-nav-item {
    font-size: 0.82rem;
  }
}
</style>
