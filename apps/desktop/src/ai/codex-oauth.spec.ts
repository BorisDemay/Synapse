import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CODEX_CHATGPT_DEVICE_PATH,
  CODEX_OAUTH_CLIENT_ID,
  completeChatgptDeviceLogin,
  extractChatgptAccountId,
  refreshChatgptTokens,
  startChatgptDeviceLogin,
} from "./codex-oauth";

const accessToken = "chatgpt-access-secret";
const refreshToken = "chatgpt-refresh-secret";
const authorizationCode = "auth-code-secret";
const codeVerifier = "pkce-verifier-secret";

function jwtWithAccount(accountId: string): string {
  const payload = btoa(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: accountId },
    }),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

describe("Codex ChatGPT device login", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests a device code with the official Codex client id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            device_auth_id: "device-1",
            interval: "0",
            user_code: "ABCD-EFGH",
          }),
          { status: 200 },
        ),
      ),
    );

    const session = await startChatgptDeviceLogin();
    expect(session.userCode).toBe("ABCD-EFGH");
    expect(session.verificationUrl).toBe(
      `https://auth.openai.com${CODEX_CHATGPT_DEVICE_PATH}`,
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://auth.openai.com/api/accounts/deviceauth/usercode",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ client_id: CODEX_OAUTH_CLIENT_ID });
  });

  it("exchanges the device approval for ChatGPT tokens without leaking secrets", async () => {
    const idToken = jwtWithAccount("acct-42");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 403 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              authorization_code: authorizationCode,
              code_challenge: "challenge",
              code_verifier: codeVerifier,
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: accessToken,
              expires_in: 3600,
              id_token: idToken,
              refresh_token: refreshToken,
            }),
            { status: 200 },
          ),
        ),
    );

    const tokens = await completeChatgptDeviceLogin({
      deviceAuthId: "device-1",
      intervalMs: 0,
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/codex/device",
    });

    expect(tokens.accessToken).toBe(accessToken);
    expect(tokens.refreshToken).toBe(refreshToken);
    expect(tokens.accountId).toBe("acct-42");
    expect(extractChatgptAccountId(idToken)).toBe("acct-42");

    const exchange = vi.mocked(fetch).mock.calls[2];
    expect(exchange?.[0]).toBe("https://auth.openai.com/oauth/token");
    expect(String(exchange?.[1]?.body)).toContain(
      "grant_type=authorization_code",
    );
    expect(String(exchange?.[1]?.body)).not.toContain("/v1/vaults");
  });

  it("refreshes ChatGPT tokens and redacts them from errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: `invalid_grant for ${refreshToken}` }),
            { status: 401 },
          ),
        ),
    );

    await expect(refreshChatgptTokens(refreshToken)).rejects.toThrow(
      "Session ChatGPT expirée. Reconnectez Codex.",
    );

    try {
      await refreshChatgptTokens(refreshToken);
    } catch (error) {
      const serialized = JSON.stringify(
        error,
        Object.getOwnPropertyNames(error),
      );
      expect(serialized).not.toContain(refreshToken);
    }
  });
});
