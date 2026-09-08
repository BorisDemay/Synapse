import { defineStore } from "pinia";

import {
  clearRememberedSession,
  clearUserUnlockMaterial,
  getRememberedSessionUser,
  rememberSessionUser,
} from "../offline/cache";
import { useVaultStore } from "./vault";

interface LoginCredentials {
  email: string;
  password: string;
  remember_device?: boolean;
}

export interface LoginOptions {
  rememberDevice?: boolean;
}

interface RegisterInput {
  email: string;
  invitationToken?: string;
  password: string;
}

export interface AuthSession {
  createdAt: string;
  current: boolean;
  id: string;
}

function csrfHeaders(): HeadersInit {
  return {
    Origin: window.location.origin,
  };
}

function jsonCsrfHeaders(): HeadersInit {
  return {
    Origin: window.location.origin,
    "content-type": "application/json",
  };
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    isLocalMode: false,
    isAuthenticated: false,
    isOfflineSession: false,
    userId: null as string | null,
    email: null as string | null,
  }),
  actions: {
    async enterLocalMode() {
      useVaultStore().lockAndRequirePassphrase();
      this.isLocalMode = true;
      this.isAuthenticated = false;
      this.isOfflineSession = true;
      this.userId = "local-device";
      this.email = null;
      await clearRememberedSession();
      await rememberSessionUser("local-device");
    },
    async restoreSession() {
      if ((await getRememberedSessionUser()) === "local-device") {
        await this.enterLocalMode();
        return true;
      }

      try {
        const response = await fetch("/v1/session", {
          credentials: "include",
        });
        if (!response.ok) {
          this.isAuthenticated = false;
          this.isOfflineSession = false;
          this.userId = null;
          this.email = null;
          return false;
        }
        const body = (await response.json()) as { user_id: string };
        this.isAuthenticated = true;
        this.isOfflineSession = false;
        this.userId = body.user_id;
        await rememberSessionUser(body.user_id);
        return true;
      } catch {
        const remembered = await getRememberedSessionUser();
        if (!remembered) {
          this.isAuthenticated = false;
          this.isOfflineSession = false;
          this.userId = null;
          this.email = null;
          return false;
        }
        this.isAuthenticated = true;
        this.isOfflineSession = true;
        this.userId = remembered;
        this.email = null;
        return true;
      }
    },
    async fetchPublicSignup() {
      try {
        const response = await fetch("/auth/signup", {
          credentials: "include",
        });
        if (!response.ok) {
          return false;
        }
        const body = (await response.json()) as { public_signup?: unknown };
        return body.public_signup === true;
      } catch {
        return false;
      }
    },
    async register(input: RegisterInput) {
      const body: Record<string, string> = {
        email: input.email,
        password: input.password,
      };
      if (input.invitationToken) {
        body.invitation_token = input.invitationToken;
      }
      const response = await fetch("/auth/signup", {
        body: JSON.stringify(body),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Registration failed");
      }
      await this.login(input.email, input.password);
    },
    async login(email: string, password: string, options: LoginOptions = {}) {
      const credentials: LoginCredentials = { email, password };
      if (options.rememberDevice) {
        credentials.remember_device = true;
      }
      const response = await fetch("/auth/login", {
        body: JSON.stringify(credentials),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Authentication failed");
      }
      this.isLocalMode = false;
      await clearRememberedSession();
      this.isAuthenticated = true;
      await this.restoreSession();
    },
    async logout() {
      const vault = useVaultStore();
      vault.lockAndRequirePassphrase();
      const userId = this.userId;
      const local = this.isLocalMode;
      this.isLocalMode = false;
      this.isAuthenticated = false;
      this.isOfflineSession = false;
      this.userId = null;
      this.email = null;
      if (userId) await clearUserUnlockMaterial(userId);
      await clearRememberedSession();
      if (local) return;
      const response = await fetch("/auth/logout", {
        credentials: "include",
        headers: csrfHeaders(),
        method: "POST",
      });
      if (!response.ok) throw new Error("Logout failed");
    },
    async changePassword(currentPassword: string, newPassword: string) {
      const response = await fetch("/auth/password", {
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
        credentials: "include",
        headers: jsonCsrfHeaders(),
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Password change failed");
      }
    },
    async listSessions(): Promise<{ email: string; sessions: AuthSession[] }> {
      const response = await fetch("/auth/sessions", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Unable to list sessions");
      }
      const body = (await response.json()) as {
        email?: unknown;
        sessions?: Array<{
          created_at?: unknown;
          current?: unknown;
          id?: unknown;
        }>;
      };
      const email = typeof body.email === "string" ? body.email : "";
      this.email = email || null;
      const sessions = (body.sessions ?? []).flatMap((item) => {
        if (
          typeof item.id !== "string" ||
          typeof item.created_at !== "string"
        ) {
          return [];
        }
        return [
          {
            createdAt: item.created_at,
            current: item.current === true,
            id: item.id,
          },
        ];
      });
      return { email, sessions };
    },
    async revokeSession(sessionId: string) {
      const response = await fetch(`/auth/sessions/${sessionId}/revoke`, {
        credentials: "include",
        headers: csrfHeaders(),
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Unable to revoke session");
      }
    },
    async revokeOtherSessions() {
      const response = await fetch("/auth/sessions/revoke-others", {
        credentials: "include",
        headers: csrfHeaders(),
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Unable to revoke sessions");
      }
    },
    async deleteAccount(password: string) {
      const vault = useVaultStore();
      const response = await fetch("/auth/account/delete", {
        body: JSON.stringify({ password }),
        credentials: "include",
        headers: jsonCsrfHeaders(),
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Account deletion failed");
      }
      await vault.clearDeviceData();
      this.isAuthenticated = false;
      this.isOfflineSession = false;
      this.userId = null;
      this.email = null;
      await clearRememberedSession();
    },
  },
});
