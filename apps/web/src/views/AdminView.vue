<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { clearToasts, notify } from "../notifications/toasts";
import { useAuthStore, type ManagedUser } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();

const users = ref<ManagedUser[]>([]);
const invitationEmail = ref("");
const invitationRole = ref<"user" | "admin">("user");
const invitationLink = ref("");
const invitationDelivered = ref<boolean | null>(null);
const loading = ref(true);
const inviting = ref(false);

const roleOptions = [
  { label: "Utilisateur", value: "user" },
  { label: "Administrateur", value: "admin" },
];

async function loadUsers() {
  try {
    users.value = await auth.listUsers();
  } catch {
    notify({
      kind: "error",
      message: "Impossible de charger les utilisateurs.",
    });
  } finally {
    loading.value = false;
  }
}

async function invite() {
  invitationLink.value = "";
  invitationDelivered.value = null;
  inviting.value = true;
  try {
    const invitation = await auth.createInvitation(
      invitationEmail.value,
      invitationRole.value === "admin",
    );
    invitationDelivered.value = invitation.emailSent;
    invitationLink.value = `${window.location.origin}/register?invitation=${encodeURIComponent(
      invitation.token,
    )}`;
    notify({
      kind: "success",
      message: invitation.emailSent
        ? `Invitation envoyée par e-mail à ${invitation.email}.`
        : `Invitation créée pour ${invitation.email}.`,
    });
    invitationEmail.value = "";
    await loadUsers();
  } catch {
    notify({ kind: "error", message: "Impossible de créer l’invitation." });
  } finally {
    inviting.value = false;
  }
}

async function signOut() {
  await auth.logout();
  clearToasts();
  await router.push("/login");
}

onMounted(loadUsers);
</script>

<template>
  <div class="admin">
    <header class="admin__header panel">
      <div>
        <h1>Administration</h1>
        <p>{{ auth.email }}</p>
      </div>
      <div class="admin__header-actions">
        <Button
          label="Ouvrir le coffre"
          severity="secondary"
          @click="router.push('/vault')"
        />
        <Button label="Se déconnecter" text @click="signOut" />
      </div>
    </header>

    <section class="panel" aria-labelledby="admin-users-title">
      <header class="panel__header">
        <h2 id="admin-users-title">Utilisateurs</h2>
        <span>{{ users.length }}</span>
      </header>
      <p v-if="loading" class="admin__muted">Chargement…</p>
      <p v-else-if="users.length === 0" class="admin__muted">
        Aucun utilisateur.
      </p>
      <table v-else class="admin__users">
        <thead>
          <tr>
            <th scope="col">Adresse</th>
            <th scope="col">Rôle</th>
            <th scope="col">État</th>
            <th scope="col">Créé le</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.email">
            <td>{{ user.email }}</td>
            <td>
              <span
                class="admin__badge"
                :class="{ 'admin__badge--admin': user.isAdmin }"
              >
                {{ user.isAdmin ? "Administrateur" : "Utilisateur" }}
              </span>
            </td>
            <td>{{ user.activated ? "Actif" : "En attente d’activation" }}</td>
            <td>{{ new Date(user.createdAt).toLocaleDateString() }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel" aria-labelledby="admin-invite-title">
      <header class="panel__header">
        <h2 id="admin-invite-title">Inviter un utilisateur</h2>
      </header>
      <p class="admin__muted">
        L’invitation envoie un lien d’inscription à usage unique, valable 24
        heures. Sans SMTP configuré, copiez le lien pour le transmettre.
      </p>
      <form class="admin__form" @submit.prevent="invite">
        <div class="admin__field">
          <label for="admin-invite-email">Adresse e-mail</label>
          <InputText
            id="admin-invite-email"
            v-model="invitationEmail"
            autocomplete="email"
            required
            type="email"
          />
        </div>
        <div class="admin__field">
          <label for="admin-invite-role">Rôle</label>
          <Select
            input-id="admin-invite-role"
            v-model="invitationRole"
            :options="roleOptions"
            option-label="label"
            option-value="value"
          />
        </div>
        <Button
          :loading="inviting"
          label="Envoyer l’invitation"
          type="submit"
        />
      </form>

      <div v-if="invitationLink" class="admin__link">
        <label for="admin-invite-link">
          {{
            invitationDelivered ? "Lien (email envoyé)" : "Lien à transmettre"
          }}
        </label>
        <InputText
          id="admin-invite-link"
          :model-value="invitationLink"
          readonly
          type="text"
          @focus="($event.target as HTMLInputElement).select()"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.admin {
  background: var(--synapse-color-surface);
  color: var(--synapse-color-text);
  display: flex;
  flex-direction: column;
  gap: var(--synapse-space-6);
  margin: 0 auto;
  max-inline-size: 56rem;
  min-block-size: 100vh;
  padding: var(--synapse-space-8) var(--synapse-space-6);
}

.admin__header {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--synapse-space-4);
  justify-content: space-between;
}

.admin__header h1 {
  font-size: 1.5rem;
  margin: 0;
}

.admin__header p {
  color: var(--synapse-color-text-muted);
  margin: var(--synapse-space-1) 0 0;
}

.admin__header-actions {
  display: flex;
  gap: var(--synapse-space-2);
}

.panel {
  background: var(--synapse-color-surface-raised);
  border: 1px solid var(--synapse-color-border);
  border-radius: var(--synapse-radius-md);
  box-shadow: var(--synapse-shadow-sm);
  padding: var(--synapse-space-5);
}

.panel__header {
  align-items: baseline;
  display: flex;
  gap: var(--synapse-space-2);
  justify-content: space-between;
  margin-block-end: var(--synapse-space-3);
}

.panel__header h2 {
  font-size: 1.1rem;
  margin: 0;
}

.panel__header span {
  color: var(--synapse-color-text-muted);
}

.admin__muted {
  color: var(--synapse-color-text-muted);
  margin: 0 0 var(--synapse-space-3);
}

.admin__users {
  border-collapse: collapse;
  inline-size: 100%;
}

.admin__users th,
.admin__users td {
  border-block-end: 1px solid var(--synapse-color-border);
  padding: var(--synapse-space-3);
  text-align: start;
}

.admin__users tr:last-child td {
  border-block-end: 0;
}

.admin__badge {
  background: var(--synapse-color-surface-muted);
  border-radius: 999px;
  font-size: 0.8rem;
  padding: 0.15rem 0.6rem;
}

.admin__badge--admin {
  background: var(--synapse-color-surface-accent);
  color: var(--synapse-color-accent-strong);
  font-weight: 600;
}

.admin__form {
  align-items: end;
  display: flex;
  flex-wrap: wrap;
  gap: var(--synapse-space-3);
}

.admin__field {
  display: flex;
  flex-direction: column;
  gap: var(--synapse-space-1);
  min-inline-size: 14rem;
}

.admin__field label {
  color: var(--synapse-color-text-muted);
  font-size: 0.85rem;
}

.admin__link {
  display: flex;
  flex-direction: column;
  gap: var(--synapse-space-1);
  margin-block-start: var(--synapse-space-4);
}

.admin__link label {
  color: var(--synapse-color-text-muted);
  font-size: 0.85rem;
}

.admin__link input {
  inline-size: 100%;
}
</style>
