/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SYNAPSE_COMMIT_SHA?: string;
  readonly VITE_SYNAPSE_VERSION?: string;
}
