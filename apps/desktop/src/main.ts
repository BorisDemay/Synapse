import { createPinia } from "pinia";
import { createApp } from "vue";

import { initializeTheme, installSynapseUi } from "@synapse/ui";

import App from "./App.vue";
import { installDesktopFetchBridge } from "./platform/fetch-bridge";
import { createAppRouter } from "./router";
import { useAuthStore } from "./stores/auth";
import "./styles.css";
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
  await auth.restoreSession().catch(() => false);

  app.use(createAppRouter());
  app.mount("#app");
}

void bootstrap();
