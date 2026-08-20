<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import Button from "primevue/button";
import Message from "primevue/message";
import Password from "primevue/password";

import { ThemeToggle } from "@synapse/ui";

import { isTrustedDeviceSupported } from "../crypto/trusted-device";
import { parseWrappedVaultKey, unlockVaultKey } from "../crypto/vault-key";
import { useVaultStore } from "../stores/vault";

const vault = useVaultStore();
const router = useRouter();
const passphrase = ref("");
const mode = ref<"loading" | "create" | "unlock">("loading");
const error = ref("");
const vaultId = ref<string | null>(null);
const hasTrustedDevice = ref(false);
const trustedDeviceSupported = ref(false);
const trustDevice = ref(false);

onMounted(async () => {
  trustedDeviceSupported.value = isTrustedDeviceSupported();
  try {
    const ids = await vault.listVaultIds();
    vaultId.value = ids[0] ?? null;
    if (!vaultId.value) {
      mode.value = "create";
      error.value =
        "Créez un coffre et une phrase de déchiffrement locale (distincte du mot de passe).";
      return;
    }
    vault.setHasEncryptedVault(true);
    hasTrustedDevice.value = await vault.hasTrustedDevice(vaultId.value);
    if (
      hasTrustedDevice.value &&
      trustedDeviceSupported.value &&
      !vault.shouldSkipTrustedUnlock()
    ) {
      try {
        await vault.unlockWithTrustedDevice(vaultId.value);
        await router.push("/vault");
        return;
      } catch {
        error.value =
          "L’appareil de confiance n’a pas pu déverrouiller le coffre. Utilisez votre phrase.";
      }
    }
    mode.value = "unlock";
    if (!error.value) {
      error.value = "Ce coffre doit être déverrouillé localement.";
    }
  } catch {
    error.value = "Impossible de découvrir le coffre.";
    mode.value = "create";
  }
});

async function submit() {
  const secret = passphrase.value;
  passphrase.value = "";
  error.value = "";
  try {
    if (mode.value === "create") {
      await vault.createAndUnlockVault(secret);
    } else if (vaultId.value) {
      const bytes = await vault.fetchEnvelopeBytes(vaultId.value);
      const envelope = parseWrappedVaultKey(bytes);
      const key = await unlockVaultKey(envelope, secret);
      try {
        vault.unlock(key, vaultId.value, 0);
        await vault.loadNotes(vaultId.value);
      } finally {
        key.fill(0);
      }
    } else {
      throw new Error("missing vault");
    }
    vault.allowTrustedUnlock();
    if (trustDevice.value && trustedDeviceSupported.value) {
      try {
        await vault.rememberCurrentDevice();
        hasTrustedDevice.value = true;
      } catch {
        error.value =
          "Coffre déverrouillé. L’appareil n’a pas pu être enregistré ; la phrase sera demandée à nouveau.";
      }
    }
    await router.push("/vault");
  } catch {
    error.value =
      mode.value === "create"
        ? "Création du coffre impossible."
        : "Déverrouillage impossible.";
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-aside" aria-label="Sécurité du coffre">
      <div>
        <div class="auth-brand">
          <span class="brand-symbol" aria-hidden="true">S</span>
          <span>Synapse</span>
        </div>
        <h1>Votre coffre, sous clé.</h1>
        <p>
          La phrase de déchiffrement déverrouille vos notes uniquement dans ce
          navigateur. Elle ne traverse jamais le réseau.
        </p>
      </div>
      <small>La confidentialité commence sur votre appareil.</small>
    </section>

    <section class="auth-content">
      <div class="auth-card">
        <div class="page-toolbar">
          <span class="brand-mark"
            ><span class="brand-symbol" aria-hidden="true">S</span>Coffre
            privé</span
          >
          <ThemeToggle />
        </div>
        <template v-if="mode === 'loading'">
          <h2>Ouverture du coffre</h2>
          <p class="subtitle">Vérification de cet appareil…</p>
        </template>
        <template v-else>
          <h2>
            {{
              mode === "create" ? "Créer un coffre" : "Déverrouiller le coffre"
            }}
          </h2>
          <p class="subtitle">
            {{
              mode === "create"
                ? "Choisissez une phrase longue et mémorable."
                : "Votre phrase reste uniquement dans la mémoire de cette session."
            }}
          </p>
          <form class="form-stack" @submit.prevent="submit">
            <div class="form-field">
              <label for="unlock-passphrase">Phrase de déchiffrement</label>
              <Password
                input-id="unlock-passphrase"
                v-model="passphrase"
                :feedback="false"
                fluid
                autocomplete="off"
                required
                toggle-mask
              />
            </div>
            <label
              v-if="trustedDeviceSupported && !hasTrustedDevice"
              class="trusted-device-option"
            >
              <input v-model="trustDevice" type="checkbox" />
              <span>Rester déverrouillé sur ce navigateur</span>
            </label>
            <Button
              :label="
                mode === 'create' ? 'Créer et déverrouiller' : 'Déverrouiller'
              "
              type="submit"
            />
          </form>
          <p v-if="error" role="alert">
            <Message severity="info" :closable="false">{{ error }}</Message>
          </p>
        </template>
      </div>
    </section>
  </main>
</template>
