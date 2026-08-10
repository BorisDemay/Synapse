import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import { registerAssetServiceWorker } from "./offline/register-sw";
import { createAppRouter } from "./router";
import { useAuthStore } from "./stores/auth";
import { useVaultStore } from "./stores/vault";
import "./styles.css";

async function bootstrap() {
  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);

  const auth = useAuthStore(pinia);
  const vault = useVaultStore(pinia);
  await auth.restoreSession().catch(() => false);
  if (auth.isAuthenticated) {
    try {
      const ids = await vault.listVaultIds();
      if (ids.length > 0) {
        vault.setHasEncryptedVault(true);
      }
    } catch {
      // Discovery failures leave the user on login/unlock guards.
    }
  }

  app.use(createAppRouter(auth, vault));
  app.mount("#app");
  registerAssetServiceWorker();
}

void bootstrap();
