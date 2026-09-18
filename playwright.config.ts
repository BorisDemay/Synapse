import { defineConfig, devices } from "@playwright/test";

const uiPort = Number(process.env.SYNAPSE_E2E_UI_PORT ?? 15173);
const apiPort = Number(process.env.SYNAPSE_E2E_API_PORT ?? 13000);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  globalSetup: "tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${uiPort}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `pnpm --filter @synapse/web build && pnpm --filter @synapse/web exec vite preview --host 127.0.0.1 --port ${uiPort} --strictPort`,
    url: `http://127.0.0.1:${uiPort}`,
    env: { SYNAPSE_API_PROXY: `http://127.0.0.1:${apiPort}` },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
