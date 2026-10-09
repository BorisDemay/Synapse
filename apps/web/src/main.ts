import { createPinia } from "pinia";
import { createApp } from "vue";

import { initializeTheme, installSynapseUi } from "@synapse/ui";

import App from "./App.vue";
import { registerAssetServiceWorker } from "./offline/register-sw";
import { requestPersistentBrowserStorage } from "./offline/storage-health";
import { createAppRouter } from "./router";
import { startSyncCoordinator } from "./sync/coordinator";
import { useAuthStore } from "./stores/auth";
import { useVaultStore } from "./stores/vault";
import { startWebUpdateChecks } from "./update/web-updates";
import "./styles.css";

async function bootstrap() {
  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);
  installSynapseUi(app);
  initializeTheme();

  const auth = useAuthStore(pinia);
  const vault = useVaultStore(pinia);
  await auth.restoreSession().catch(() => false);
  if (auth.isAuthenticated) {
    void auth.refreshStorageHealth();
  }
  if (auth.isAuthenticated) {
    try {
      if (await vault.tryUnlockFromTrustedDevice()) {
        // Session restore can skip the unlock page entirely.
      } else {
        const ids = await vault.listVaultIds();
        if (ids.length > 0) {
          vault.setHasEncryptedVault(true);
        }
      }
    } catch {
      // Discovery failures leave the user on login/unlock guards.
    }
  }

  app.use(createAppRouter(auth, vault));
  app.mount("#app");
  void requestPersistentBrowserStorage();
  startSyncCoordinator(auth, vault);
  registerAssetServiceWorker();
  startWebUpdateChecks();
}

void bootstrap();
