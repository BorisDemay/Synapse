import { createUpdateCoordinator, startUpdateChecks } from "@synapse/ui";

import { createWebUpdateProvider } from "./web-provider";

const currentBuild = {
  commitSha: import.meta.env.VITE_SYNAPSE_COMMIT_SHA ?? "development",
  version: import.meta.env.VITE_SYNAPSE_VERSION ?? "0.1.0",
};

export const webUpdateCoordinator = createUpdateCoordinator(
  createWebUpdateProvider(currentBuild),
  { activationLabel: "Recharger" },
);

export function startWebUpdateChecks(): () => void {
  return startUpdateChecks(webUpdateCoordinator);
}
