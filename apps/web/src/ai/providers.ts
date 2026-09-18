/**
 * Providers for the writing assistant. Any endpoint speaking the
 * OpenAI-compatible Chat Completions API works with just an API key; ChatGPT
 * keeps its device-code login flow.
 */
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
  {
    id: "glm",
    label: "GLM (Zhipu)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModels: ["glm-4.6", "glm-4.5-air"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModels: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "mistral",
    label: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    id: "custom",
    label: "Autre (URL compatible OpenAI)",
    baseUrl: "",
    needsBaseUrl: true,
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
