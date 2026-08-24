import { createPinia } from "pinia";
import { createApp } from "vue";

import { initializeTheme, installSynapseUi } from "@synapse/ui";

import App from "../../web/src/App.vue";
import { createAppRouter } from "../../web/src/router";
import { useAuthStore } from "../../web/src/stores/auth";
import { useVaultStore } from "../../web/src/stores/vault";
import { installDesktopFetchBridge } from "./platform/fetch-bridge";
import "../../web/src/styles.css";

async function bootstrap() {
  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);
  installSynapseUi(app);
  initializeTheme();
  document.documentElement.lang = "fr";

  installDesktopFetchBridge({
    instanceUrl: import.meta.env.DEV ? "http://127.0.0.1:3000" : undefined,
  });
  const auth = useAuthStore(pinia);
  const vault = useVaultStore(pinia);
  await auth.restoreSession().catch(() => false);

  if (auth.isAuthenticated) {
    try {
      if (!(await vault.tryUnlockFromTrustedDevice())) {
        const ids = await vault.listVaultIds();
        if (ids.length > 0) {
          vault.setHasEncryptedVault(true);
        }
      }
    } catch {
      // The shared client can still use its encrypted offline cache.
    }
  }

  app.use(createAppRouter(auth, vault));
  app.mount("#app");
}

void bootstrap();
