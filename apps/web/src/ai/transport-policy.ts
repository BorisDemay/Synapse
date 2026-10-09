export type AssistantProviderId = "chatgpt" | "codex";

interface AssistantTransportDestination {
  origin: string;
  providerId: AssistantProviderId;
  routes: readonly string[];
}

export const ASSISTANT_TRANSPORT_DESTINATIONS = [
  {
    origin: "https://api.openai.com",
    providerId: "codex",
    routes: ["/v1/models", "/v1/responses"],
  },
  {
    origin: "https://auth.openai.com",
    providerId: "chatgpt",
    routes: [
      "/api/accounts/deviceauth/token",
      "/api/accounts/deviceauth/usercode",
      "/oauth/token",
    ],
  },
  {
    origin: "https://chatgpt.com",
    providerId: "chatgpt",
    routes: ["/backend-api/codex/models", "/backend-api/codex/responses"],
  },
] as const satisfies readonly AssistantTransportDestination[];

export function assertAllowedAssistantTransport(
  providerId: string | undefined,
  rawUrl: string,
): asserts providerId is AssistantProviderId {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("La destination de l’assistant n’est pas autorisée.");
  }

  const destination = ASSISTANT_TRANSPORT_DESTINATIONS.find(
    (candidate) =>
      candidate.providerId === providerId && candidate.origin === url.origin,
  );
  if (
    url.protocol !== "https:" ||
    !destination ||
    !(destination.routes as readonly string[]).includes(url.pathname)
  ) {
    throw new Error("La destination de l’assistant n’est pas autorisée.");
  }
}
