<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { useAuthStore, type ManagedUser } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();

const users = ref<ManagedUser[]>([]);
const invitationEmail = ref("");
const invitationLink = ref("");
const status = ref("");
const error = ref("");
const loading = ref(true);

async function loadUsers() {
  error.value = "";
  try {
    users.value = await auth.listUsers();
  } catch {
    error.value = "Impossible de charger les utilisateurs.";
  } finally {
    loading.value = false;
  }
}

async function invite() {
  error.value = "";
  status.value = "";
  invitationLink.value = "";
  try {
    const invitation = await auth.createInvitation(invitationEmail.value);
    invitationLink.value = `${window.location.origin}/register?invitation=${encodeURIComponent(
      invitation.token,
    )}`;
    status.value = `Invitation créée pour ${invitation.email}.`;
    invitationEmail.value = "";
    await loadUsers();
  } catch {
    error.value = "Impossible de créer l’invitation.";
  }
}

async function signOut() {
  await auth.logout();
  await router.push("/login");
}

onMounted(loadUsers);
</script>

<template>
  <main class="synapse-admin">
    <header class="synapse-admin__header">
      <div>
        <h1>Administration</h1>
        <p class="synapse-admin__account">{{ auth.email }}</p>
      </div>
      <button type="button" @click="signOut">Se déconnecter</button>
    </header>

    <section aria-labelledby="admin-users-title">
      <h2 id="admin-users-title">Utilisateurs</h2>
      <p v-if="loading">Chargement…</p>
      <table v-else class="synapse-admin__users">
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
            <td>{{ user.isAdmin ? "Administrateur" : "Utilisateur" }}</td>
            <td>{{ user.activated ? "Actif" : "En attente" }}</td>
            <td>{{ new Date(user.createdAt).toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section aria-labelledby="admin-invite-title">
      <h2 id="admin-invite-title">Inviter un utilisateur</h2>
      <form @submit.prevent="invite">
        <label for="admin-invite-email">Adresse e-mail à inviter</label>
        <input
          id="admin-invite-email"
          v-model="invitationEmail"
          autocomplete="off"
          required
          type="email"
        />
        <button type="submit">Créer l’invitation</button>
      </form>
      <p v-if="status" role="status">{{ status }}</p>
      <p v-if="invitationLink">
        Lien d’invitation :
        <a :href="invitationLink">{{ invitationLink }}</a>
      </p>
    </section>

    <p v-if="error" role="alert" class="synapse-admin__error">{{ error }}</p>
  </main>
</template>

<style scoped>
.synapse-admin {
  margin: 0 auto;
  max-width: 52rem;
  padding: 2rem 1.5rem 4rem;
}

.synapse-admin__header {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.synapse-admin__account {
  color: var(--synapse-text-muted, #64748b);
  margin: 0.25rem 0 0;
}

.synapse-admin__users {
  border-collapse: collapse;
  inline-size: 100%;
}

.synapse-admin__users th,
.synapse-admin__users td {
  border-block-end: 1px solid var(--synapse-border, #334155);
  padding: 0.5rem 0.75rem;
  text-align: start;
}

.synapse-admin__error {
  color: var(--synapse-danger, #dc2626);
}

form {
  align-items: end;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

label {
  display: block;
  inline-size: 100%;
}

input {
  font: inherit;
  padding: 0.4rem 0.6rem;
}

button {
  cursor: pointer;
  font: inherit;
  padding: 0.45rem 0.9rem;
}
</style>
