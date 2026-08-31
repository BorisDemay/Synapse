import { createUpdateCoordinator, startUpdateChecks } from "@synapse/ui";

import { createDesktopUpdateProvider } from "./desktop-provider";

export const desktopUpdateCoordinator = createUpdateCoordinator(
  createDesktopUpdateProvider(),
  { activationLabel: "Installer et redémarrer" },
);

export function startDesktopUpdateChecks(): () => void {
  return startUpdateChecks(desktopUpdateCoordinator);
}
