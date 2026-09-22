<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import Button from "primevue/button";

import { ThemeToggle } from "@synapse/ui";

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
    status.value =
      "Compte activé. Vous pouvez vous connecter. À la première connexion, vous créerez la phrase de coffre qui chiffre vos notes localement.";
  } catch (cause) {
    status.value =
      cause instanceof TypeError
        ? "Activation impossible : le serveur est injoignable. Vérifiez votre connexion, puis réessayez en rouvrant le lien reçu par email."
        : "Activation impossible. Le lien a peut-être expiré ou déjà été utilisé. Vérifiez votre connexion, puis réessayez en rouvrant le lien reçu par email ; sinon, demandez un nouveau lien à l’administrateur de l’instance.";
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
          Un espace Markdown local-first, privé et synchronisé. Écrivez sans
          perdre le fil, même lorsque le réseau disparaît.
        </p>
      </div>
      <small>Chiffré localement. Auto-hébergeable. Ouvert.</small>
    </section>

    <section class="auth-content">
      <div class="auth-card">
        <div class="page-toolbar">
          <span class="brand-mark"
            ><span class="brand-symbol" aria-hidden="true">S</span
            >Activation</span
          >
          <ThemeToggle />
        </div>
        <h2>Activer votre compte</h2>
        <p class="subtitle">
          Confirmez l’activation du compte associé à ce lien.
        </p>
        <div class="form-actions">
          <Button
            v-if="!activated"
            :disabled="busy"
            :loading="busy"
            label="Activer le compte"
            type="button"
            @click="activate"
          />
          <RouterLink to="/login" class="form-actions-link">
            <Button
              label="Se connecter"
              :severity="activated ? undefined : 'secondary'"
            />
          </RouterLink>
        </div>
        <p v-if="status" role="status" class="form-hint">{{ status }}</p>
      </div>
    </section>
  </main>
</template>
