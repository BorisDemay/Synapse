<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
const route = useRoute();
const router = useRouter();
let token = typeof route.query.token === "string" ? route.query.token : "";
const status = ref("");
const busy = ref(false);
const activated = ref(false);
onMounted(() => {
  if (token) void router.replace("/activate");
});
async function activate() {
  if (!token) {
    status.value = "Lien d’activation absent ou invalide.";
    return;
  }
  busy.value = true;
  try {
    const response = await fetch("/auth/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      credentials: "include",
    });
    if (!response.ok) throw new Error("Activation failed");
    token = "";
    activated.value = true;
    status.value = "Compte activé. Vous pouvez vous connecter.";
  } catch {
    status.value =
      "Activation impossible. Le lien peut avoir expiré ou avoir déjà été utilisé.";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <main class="auth-page">
    <section class="auth-content">
      <div class="auth-card">
        <h1>Activer votre compte</h1>
        <p>Confirmez l’activation du compte associé à ce lien.</p>
        <button
          v-if="!activated"
          :disabled="busy"
          type="button"
          @click="activate"
        >
          Activer le compte
        </button>
        <p v-if="status" role="status">{{ status }}</p>
        <RouterLink to="/login">Se connecter</RouterLink>
      </div>
    </section>
  </main>
</template>
