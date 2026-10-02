import { config } from "@vue/test-utils";
import { resetTooltip, synapseTooltip } from "@synapse/ui";
import { afterEach } from "vitest";

config.global.directives = {
  ...config.global.directives,
  synapseTooltip,
};

afterEach(() => {
  resetTooltip();
});
