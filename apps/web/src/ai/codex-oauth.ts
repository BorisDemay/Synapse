export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_OAUTH_ISSUER = "https://auth.openai.com";
export const CODEX_CHATGPT_DEVICE_PATH = "/codex/device";
export const CODEX_CHATGPT_RESPONSES_URL =
  "https://chatgpt.com/backend-api/codex/responses";
export const CODEX_CHATGPT_MODELS_URL =
  "https://chatgpt.com/backend-api/codex/models";
export const CODEX_CLIENT_VERSION = "0.147.0";

export function chatgptModelsUrl(): string {
  return `${CODEX_CHATGPT_MODELS_URL}?client_version=${encodeURIComponent(CODEX_CLIENT_VERSION)}`;
}

const USERCODE_URL = `${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/token`;
const OAUTH_TOKEN_URL = `${CODEX_OAUTH_ISSUER}/oauth/token`;
const DEVICE_REDIRECT_URI = `${CODEX_OAUTH_ISSUER}/deviceauth/callback`;
const DEVICE_LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

export interface ChatgptDeviceSession {
  deviceAuthId: string;
  intervalMs: number;
  userCode: string;
  verificationUrl: string;
}

export interface ChatgptTokens {
  accessToken: string;
  accountId?: string;
  expiresAt: number;
  refreshToken: string;
}

function oauthError(message: string): Error {
  return new Error(message);
}

function cancelledError(): Error {
  return oauthError("Connexion ChatGPT annulée.");
}

function parseIntervalMs(value: unknown): number {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 5_000;
  }
  return seconds * 1_000;
}

export function extractChatgptAccountId(jwt: string): string | undefined {
  const parts = jwt.split(".");
  if (parts.length < 2 || !parts[1]) {
    return undefined;
  }
  try {
    const padded = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    const json = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const claims = JSON.parse(json) as {
      chatgpt_account_id?: unknown;
      "https://api.openai.com/auth"?: { chatgpt_account_id?: unknown };
    };
    const nested = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
    const accountId =
      typeof claims.chatgpt_account_id === "string"
        ? claims.chatgpt_account_id
        : typeof nested === "string"
          ? nested
          : undefined;
    return accountId?.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw cancelledError();
  }
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(cancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function startChatgptDeviceLogin(): Promise<ChatgptDeviceSession> {
  let response: Response;
  try {
    response = await fetch(USERCODE_URL, {
      body: JSON.stringify({ client_id: CODEX_OAUTH_CLIENT_ID }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch {
    throw oauthError("Impossible de démarrer la connexion ChatGPT.");
  }
  if (response.status === 404) {
    throw oauthError(
      "Activez « Se connecter avec un code d’appareil » dans les paramètres ChatGPT.",
    );
  }
  if (!response.ok) {
    throw oauthError("Impossible de démarrer la connexion ChatGPT.");
  }
  const body = (await response.json()) as {
    device_auth_id?: unknown;
    interval?: unknown;
    user_code?: unknown;
  };
  if (
    typeof body.device_auth_id !== "string" ||
    typeof body.user_code !== "string"
  ) {
    throw oauthError("Impossible de démarrer la connexion ChatGPT.");
  }
  return {
    deviceAuthId: body.device_auth_id,
    intervalMs: parseIntervalMs(body.interval),
    userCode: body.user_code,
    verificationUrl: `${CODEX_OAUTH_ISSUER}${CODEX_CHATGPT_DEVICE_PATH}`,
  };
}

async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
): Promise<ChatgptTokens> {
  let response: Response;
  try {
    response = await fetch(OAUTH_TOKEN_URL, {
      body: new URLSearchParams({
        client_id: CODEX_OAUTH_CLIENT_ID,
        code,
        code_verifier: codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: DEVICE_REDIRECT_URI,
      }).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
  } catch {
    throw oauthError("Impossible de terminer la connexion ChatGPT.");
  }
  if (!response.ok) {
    throw oauthError("Impossible de terminer la connexion ChatGPT.");
  }
  const body = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
    id_token?: unknown;
    refresh_token?: unknown;
  };
  if (
    typeof body.access_token !== "string" ||
    typeof body.refresh_token !== "string"
  ) {
    throw oauthError("Impossible de terminer la connexion ChatGPT.");
  }
  const expiresIn =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? body.expires_in
      : 3600;
  const idToken = typeof body.id_token === "string" ? body.id_token : "";
  return {
    accessToken: body.access_token,
    accountId:
      extractChatgptAccountId(idToken) ??
      extractChatgptAccountId(body.access_token),
    expiresAt: Date.now() + expiresIn * 1000,
    refreshToken: body.refresh_token,
  };
}

export async function completeChatgptDeviceLogin(
  session: ChatgptDeviceSession,
  options: { signal?: AbortSignal } = {},
): Promise<ChatgptTokens> {
  const started = Date.now();
  while (Date.now() - started < DEVICE_LOGIN_TIMEOUT_MS) {
    if (options.signal?.aborted) {
      throw cancelledError();
    }
    let response: Response;
    try {
      response = await fetch(DEVICE_TOKEN_URL, {
        body: JSON.stringify({
          device_auth_id: session.deviceAuthId,
          user_code: session.userCode,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: options.signal,
      });
    } catch {
      if (options.signal?.aborted) {
        throw cancelledError();
      }
      throw oauthError("Impossible de terminer la connexion ChatGPT.");
    }
    if (response.ok) {
      const body = (await response.json()) as {
        authorization_code?: unknown;
        code_verifier?: unknown;
      };
      if (
        typeof body.authorization_code !== "string" ||
        typeof body.code_verifier !== "string"
      ) {
        throw oauthError("Impossible de terminer la connexion ChatGPT.");
      }
      return exchangeAuthorizationCode(
        body.authorization_code,
        body.code_verifier,
      );
    }
    if (response.status === 403 || response.status === 404) {
      await sleep(session.intervalMs, options.signal);
      continue;
    }
    throw oauthError("Impossible de terminer la connexion ChatGPT.");
  }
  throw oauthError("Connexion ChatGPT expirée.");
}

export async function refreshChatgptTokens(
  refreshToken: string,
): Promise<ChatgptTokens> {
  const token = refreshToken.trim();
  if (!token) {
    throw oauthError("Session ChatGPT expirée. Reconnectez Codex.");
  }
  let response: Response;
  try {
    response = await fetch(OAUTH_TOKEN_URL, {
      body: JSON.stringify({
        client_id: CODEX_OAUTH_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: token,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch {
    throw oauthError("Impossible de renouveler la session ChatGPT.");
  }
  if (response.status === 401 || response.status === 400) {
    throw oauthError("Session ChatGPT expirée. Reconnectez Codex.");
  }
  if (!response.ok) {
    throw oauthError("Impossible de renouveler la session ChatGPT.");
  }
  const body = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
    id_token?: unknown;
    refresh_token?: unknown;
  };
  if (typeof body.access_token !== "string") {
    throw oauthError("Impossible de renouveler la session ChatGPT.");
  }
  const nextRefresh =
    typeof body.refresh_token === "string" ? body.refresh_token : token;
  const expiresIn =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? body.expires_in
      : 3600;
  const idToken = typeof body.id_token === "string" ? body.id_token : "";
  return {
    accessToken: body.access_token,
    accountId:
      extractChatgptAccountId(idToken) ??
      extractChatgptAccountId(body.access_token),
    expiresAt: Date.now() + expiresIn * 1000,
    refreshToken: nextRefresh,
  };
}
