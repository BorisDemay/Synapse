import PrimeVue from "primevue/config";
import type { App } from "vue";

import { initializeTheme } from "./theme";

export function installSynapseUi(app: App) {
  initializeTheme();
  app.use(PrimeVue, {
    unstyled: true,
  });
}
