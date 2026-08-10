<script setup lang="ts">
import { ref } from "vue";
import { RouterLink, useRouter } from "vue-router";

import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const email = ref("");
const password = ref("");
const invitationToken = ref("");
const error = ref("");

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
    await router.push("/unlock");
  } catch {
    password.value = "";
    error.value =
      "Inscription impossible. Vérifiez l’invitation ou que l’inscription publique est activée.";
  }
}
</script>

<template>
  <main>
    <h1>Créer un compte</h1>
    <form @submit.prevent="submit">
      <label
        >Email
        <input v-model="email" autocomplete="username" required type="email"
      /></label>
      <label
        >Mot de passe
        <input
          v-model="password"
          autocomplete="new-password"
          required
          type="password"
      /></label>
      <label
        >Jeton d’invitation
        <input
          v-model="invitationToken"
          autocomplete="off"
          placeholder="Optionnel si l’inscription publique est ouverte"
          type="text"
      /></label>
      <button type="submit">S’inscrire</button>
    </form>
    <p>
      Déjà un compte ?
      <RouterLink to="/login">Se connecter</RouterLink>
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
  </main>
</template>
