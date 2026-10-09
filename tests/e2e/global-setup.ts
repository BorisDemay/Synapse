import { startTestBackend } from "../harness/backend.mjs";
export default async function globalSetup() {
  const backend = await startTestBackend({
    port: Number(process.env.SYNAPSE_E2E_API_PORT ?? 13000),
    origin: `http://127.0.0.1:${Number(process.env.SYNAPSE_E2E_UI_PORT ?? 15173)}`,
  });
  process.env.SYNAPSE_E2E_MAIL_DIRECTORY = backend.mailDirectory;
  return backend.close;
}
