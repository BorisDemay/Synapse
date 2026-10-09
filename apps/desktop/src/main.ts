import { createPinia } from "pinia";
import { createApp } from "vue";

import { initializeTheme, installSynapseUi } from "@synapse/ui";

import App from "./App.vue";
import {
  installDesktopLocalFolder,
  startDesktopFolderMirroring,
} from "./platform/local-folder";
import { installDesktopFetchBridge } from "./platform/fetch-bridge";
import { createAppRouter } from "./router";
import { useAuthStore } from "../../web/src/stores/auth";
import { useVaultStore } from "../../web/src/stores/vault";
import { startSyncCoordinator } from "../../web/src/sync/coordinator";
import { startDesktopUpdateChecks } from "./update/desktop-updates";
import "./styles.css";
import "../../web/src/styles.css";

async function bootstrap() {
  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);
  installSynapseUi(app);
  initializeTheme();
  document.documentElement.lang = "fr";

  installDesktopLocalFolder();
  installDesktopFetchBridge({
    instanceUrl: import.meta.env.DEV ? "http://127.0.0.1:3000" : undefined,
  });
  const auth = useAuthStore(pinia);
  const vault = useVaultStore(pinia);
  startDesktopFolderMirroring(vault);
  await auth.restoreSession().catch(() => false);
  if (auth.isAuthenticated) {
    void auth.refreshStorageHealth();
  }
  if (auth.isAuthenticated || auth.isLocalMode) {
    try {
      if (!(await vault.tryUnlockFromTrustedDevice())) {
        const ids = await vault.listVaultIds();
        if (ids.length > 0) {
          vault.setHasEncryptedVault(true);
        }
      }
    } catch {
      // The route guard retains the user on the safe unlock path.
    }
  }

  app.use(createAppRouter(auth, vault));
  app.mount("#app");
  startSyncCoordinator(auth, vault, { websocket: false });
  startDesktopUpdateChecks();
}

void bootstrap();
