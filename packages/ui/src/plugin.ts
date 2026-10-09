import PrimeVue from "primevue/config";
import type { App } from "vue";

import { initializeTheme } from "./theme";
import { synapseTooltip } from "./tooltip";

export function installSynapseUi(app: App) {
  initializeTheme();
  app.directive("synapse-tooltip", synapseTooltip);
  app.use(PrimeVue, {
    unstyled: true,
    // Bande haute réservée aux overlays internes de PrimeVue (aujourd'hui : le Select).
    // Elle doit rester au-dessus de `--synapse-z-*` (styles/tokens.css) pour qu'une
    // liste déroulante s'affiche au-dessus de la modale qui la contient.
    zIndex: {
      overlay: 2000,
      menu: 2000,
      modal: 2100,
      tooltip: 2200,
    },
  });
}
