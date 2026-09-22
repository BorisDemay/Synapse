<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  isLocalFolderSupported,
  localFolderStatus,
  chooseLocalVaultFolder,
  bindLocalVaultFolder,
  ensureLocalVaultFolder,
} from "../platform/local-folder";
import { useRouter } from "vue-router";

import Button from "primevue/button";
import Message from "primevue/message";
import Password from "primevue/password";

import { ThemeToggle } from "@synapse/ui";

import { isTrustedDeviceSupported } from "../crypto/trusted-device";
import { parseWrappedVaultKey, unlockVaultKey } from "../crypto/vault-key";
import { useVaultStore } from "../stores/vault";
import { useAuthStore } from "../stores/auth";

const vault = useVaultStore();
const auth = useAuthStore();
const router = useRouter();
const passphrase = ref("");
const confirmPassphrase = ref("");
const mode = ref<"loading" | "create" | "unlock" | "error">("loading");
const error = ref("");
const busy = ref(false);
const unlockedNotice = ref("");
const vaultId = ref<string | null>(null);
const hasTrustedDevice = ref(false);
const trustedDeviceSupported = ref(false);
const trustDevice = ref(false);
const folderChoice = ref<"default" | "choose">("default");

async function discover(): Promise<void> {
  error.value = "";
  mode.value = "loading";
  try {
    const ids = await vault.listVaultIds();
    vaultId.value = ids[0] ?? null;
    if (!vaultId.value) {
      mode.value = "create";
      error.value =
        "Créez un coffre et une phrase de déchiffrement locale (distincte de votre mot de passe de compte).";
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
    error.value =
      "Impossible de découvrir le coffre. Vérifiez votre connexion, puis réessayez.";
    mode.value = "error";
  }
}

onMounted(() => {
  trustedDeviceSupported.value = isTrustedDeviceSupported();
  void discover();
});

async function retryDiscovery(): Promise<void> {
  if (busy.value) return;
  await discover();
}

async function submit() {
  if (busy.value) return;
  const secret = passphrase.value;
  error.value = "";
  busy.value = true;
  try {
    if (mode.value === "create") {
      if (confirmPassphrase.value !== secret) {
        error.value =
          "Les deux phrases ne correspondent pas. Vérifiez la confirmation.";
        return;
      }
      const folder =
        isLocalFolderSupported() && folderChoice.value === "choose"
          ? await chooseLocalVaultFolder("")
          : null;
      if (
        isLocalFolderSupported() &&
        folderChoice.value === "choose" &&
        !folder
      ) {
        error.value =
          "Sélection du dossier annulée. Le coffre n’a pas été créé ; vos saisies sont conservées.";
        return;
      }
      await vault.createAndUnlockVault(secret);
      passphrase.value = "";
      confirmPassphrase.value = "";
      if (isLocalFolderSupported() && vault.currentVaultId) {
        try {
          if (folder) await bindLocalVaultFolder(vault.currentVaultId, folder);
          else await ensureLocalVaultFolder(vault.currentVaultId);
        } catch {
          localFolderStatus.error =
            "Coffre créé et conservé dans le cache chiffré. Choisissez un dossier Markdown vide dans le coffre.";
        }
      }
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
      passphrase.value = "";
    } else {
      throw new Error("missing vault");
    }
    vault.allowTrustedUnlock();
    if (trustDevice.value && trustedDeviceSupported.value) {
      try {
        await vault.rememberCurrentDevice();
        hasTrustedDevice.value = true;
        await router.push("/vault");
      } catch {
        unlockedNotice.value =
          "Coffre déverrouillé. L’appareil n’a pas pu être enregistré ; la phrase sera demandée à nouveau.";
      }
    } else {
      await router.push("/vault");
    }
  } catch {
    passphrase.value = "";
    confirmPassphrase.value = "";
    error.value =
      mode.value === "create"
        ? "Création du coffre impossible. Réessayez dans un instant."
        : "Déverrouillage impossible. Vérifiez votre phrase de déchiffrement.";
  } finally {
    busy.value = false;
  }
}

async function continueToVault(): Promise<void> {
  await router.push("/vault");
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
          La phrase de déchiffrement déverrouille vos notes uniquement sur cet
          appareil. Elle ne traverse jamais le réseau.
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
        <template v-if="unlockedNotice">
          <h2>Coffre déverrouillé</h2>
          <p class="subtitle" role="status">{{ unlockedNotice }}</p>
          <div class="form-stack">
            <Button label="Continuer" @click="continueToVault" />
          </div>
        </template>
        <template v-else-if="mode === 'loading'">
          <h2>Ouverture du coffre</h2>
          <p class="subtitle">Vérification de cet appareil…</p>
        </template>
        <template v-else-if="mode === 'error'">
          <h2>Coffre indisponible</h2>
          <p class="subtitle" role="alert">{{ error }}</p>
          <div class="form-stack">
            <Button
              label="Réessayer"
              :disabled="busy"
              @click="retryDiscovery"
            />
          </div>
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
          <ol
            v-if="mode === 'create'"
            class="onboarding-steps"
            aria-label="Étapes de démarrage"
          >
            <li v-if="auth.isLocalMode">
              Aucun compte ni serveur : ce coffre reste sur cet appareil.
            </li>
            <li v-else>
              Votre compte est activé ; protégez maintenant vos notes.
            </li>
            <li>Créez un coffre protégé par votre phrase de déchiffrement.</li>
            <li>Rédigez votre première note, chiffrée sur cet appareil.</li>
          </ol>
          <form class="form-stack" @submit.prevent="submit">
            <label v-if="mode === 'create' && isLocalFolderSupported()">
              Dossier Markdown local
              <select
                v-model="folderChoice"
                aria-label="Dossier Markdown local"
              >
                <option value="default">Créer dans Documents/Synapse</option>
                <option value="choose">Choisir un dossier</option>
              </select>
            </label>
            <p v-if="mode === 'create'" class="subtitle">
              Cette phrase est
              <strong>distincte de votre mot de passe de compte</strong> : elle
              chiffre vos notes localement et ne quitte jamais cet appareil.
              <strong
                >Synapse ne pourra ni la réinitialiser ni déchiffrer vos notes
                si vous la perdez.</strong
              >
              Conservez-la en lieu sûr.
            </p>
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
            <div v-if="mode === 'create'" class="form-field">
              <label for="unlock-passphrase-confirm"
                >Confirmer la phrase de déchiffrement</label
              >
              <Password
                input-id="unlock-passphrase-confirm"
                v-model="confirmPassphrase"
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
              <span
                >Rester déverrouillé sur ce navigateur. À éviter sur un profil
                partagé : quiconque accède à ce navigateur pourra ouvrir le
                coffre.</span
              >
            </label>
            <Button
              :label="
                mode === 'create' ? 'Créer et déverrouiller' : 'Déverrouiller'
              "
              type="submit"
              :loading="busy"
              :disabled="busy"
            />
          </form>
          <p v-if="error" role="alert">
            <Message severity="warn" :closable="false">{{ error }}</Message>
          </p>
        </template>
      </div>
    </section>
  </main>
</template>
