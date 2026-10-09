/** Only destinations admitted by the local fail-closed transport registry. */
export interface AssistantProvider {
  id: string;
  label: string;
  /** OpenAI-compatible base URL; empty when not applicable. */
  baseUrl: string;
  /** Uses the ChatGPT device-code login instead of an API key. */
  deviceLogin?: boolean;
  /** Selector flag for providers that need a manual base URL. */
  needsBaseUrl?: boolean;
  /** Fallback model ids when the provider does not expose /models. */
  defaultModels?: string[];
}

export const ASSISTANT_PROVIDERS: AssistantProvider[] = [
  {
    id: "chatgpt",
    label: "ChatGPT (connexion appareil)",
    baseUrl: "",
    deviceLogin: true,
  },
  {
    id: "codex",
    label: "OpenAI — clé API",
    baseUrl: "https://api.openai.com/v1",
  },
];

export function findAssistantProvider(
  id: string,
): AssistantProvider | undefined {
  return ASSISTANT_PROVIDERS.find((provider) => provider.id === id);
}

/** Resolves the base URL for a provider id + optional manual override. */
export function resolveProviderBaseUrl(
  providerId: string,
  customBaseUrl?: string,
): string {
  const provider = findAssistantProvider(providerId);
  if (provider?.needsBaseUrl) {
    return (customBaseUrl ?? "").trim().replace(/\/+$/, "");
  }
  return provider?.baseUrl ?? "";
}

/** True when the provider id speaks the plain API-key flow. */
export function isApiKeyProvider(providerId: string): boolean {
  return !findAssistantProvider(providerId)?.deviceLogin;
}
