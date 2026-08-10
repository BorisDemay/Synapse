<script setup lang="ts">
import { ref } from "vue";
import { RouterLink, useRouter } from "vue-router";

import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref("");

async function submit() {
  error.value = "";
  try {
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
  <main>
    <h1>Connexion</h1>
    <form @submit.prevent="submit">
      <label
        >Email
        <input v-model="email" autocomplete="username" required type="email"
      /></label>
      <label
        >Mot de passe
        <input
          v-model="password"
          autocomplete="current-password"
          required
          type="password"
      /></label>
      <button type="submit">Se connecter</button>
    </form>
    <p>
      Pas encore de compte ?
      <RouterLink to="/register">S’inscrire</RouterLink>
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
  </main>
</template>
