import { invoke } from "@tauri-apps/api/core";
import { defineStore } from "pinia";

import { useVaultStore } from "./vault";

const INSTANCE_URL_KEY = "synapse-instance-url";

export interface AuthSession {
  createdAt: string;
  current: boolean;
  id: string;
}

function rememberedInstanceUrl(): string {
  return localStorage.getItem(INSTANCE_URL_KEY) ?? "http://127.0.0.1:3000";
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    configuredInstanceUrl: null as string | null,
    email: null as string | null,
    instanceUrl: rememberedInstanceUrl(),
    isAuthenticated: false,
    isOfflineSession: false,
    userId: null as string | null,
  }),
  actions: {
    async configureInstance(url: string) {
      const origin = await invoke<string>("set_instance_url", { url });
      this.instanceUrl = url;
      this.configuredInstanceUrl = url;
      localStorage.setItem(INSTANCE_URL_KEY, url);
      return origin;
    },
    async ensureInstance() {
      if (!this.instanceUrl.trim()) {
        throw new Error("Instance URL missing");
      }
      const url = this.instanceUrl.trim();
      if (this.configuredInstanceUrl !== url) {
        await this.configureInstance(url);
      }
    },
    async request(path: string, init?: RequestInit) {
      await this.ensureInstance();
      return fetch(path, { credentials: "include", ...init });
    },
    async restoreSession() {
      try {
        const response = await this.request("/v1/session");
        if (!response.ok) {
          this.isAuthenticated = false;
          this.userId = null;
          return false;
        }
        const session = (await response.json()) as { user_id?: unknown };
        if (typeof session.user_id !== "string") {
          throw new Error("instance returned an invalid session");
        }
        this.isAuthenticated = true;
        this.isOfflineSession = false;
        this.userId = session.user_id;
        return true;
      } catch {
        this.isAuthenticated = false;
        this.userId = null;
        return false;
      }
    },
    async fetchPublicSignup() {
      try {
        const response = await this.request("/auth/signup");
        if (!response.ok) return false;
        const body = (await response.json()) as { public_signup?: unknown };
        return body.public_signup === true;
      } catch {
        return false;
      }
    },
    async login(email: string, password: string) {
      const response = await this.request("/auth/login", {
        body: JSON.stringify({ email, password }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("authentication failed");
      if (!(await this.restoreSession())) {
        throw new Error("session unavailable");
      }
    },
    async register(input: {
      email: string;
      invitationToken?: string;
      password: string;
    }) {
      const response = await this.request("/auth/signup", {
        body: JSON.stringify({
          email: input.email,
          invitation_token: input.invitationToken,
          password: input.password,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("registration failed");
      await this.login(input.email, input.password);
    },
    async logout() {
      const vault = useVaultStore();
      await vault.lock();
      try {
        const response = await this.request("/auth/logout", { method: "POST" });
        if (!response.ok) throw new Error("logout failed");
      } finally {
        this.isAuthenticated = false;
        this.userId = null;
        this.email = null;
      }
    },
    async changePassword(currentPassword: string, newPassword: string) {
      const response = await this.request("/auth/password", {
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("password change failed");
    },
    async listSessions(): Promise<{ email: string; sessions: AuthSession[] }> {
      const response = await this.request("/auth/sessions");
      if (!response.ok) throw new Error("unable to list sessions");
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
      return {
        email,
        sessions: (body.sessions ?? []).flatMap((session) =>
          typeof session.id === "string" &&
          typeof session.created_at === "string"
            ? [
                {
                  createdAt: session.created_at,
                  current: session.current === true,
                  id: session.id,
                },
              ]
            : [],
        ),
      };
    },
    async revokeSession(sessionId: string) {
      const response = await this.request(
        `/auth/sessions/${sessionId}/revoke`,
        {
          method: "POST",
        },
      );
      if (!response.ok) throw new Error("unable to revoke session");
    },
    async revokeOtherSessions() {
      const response = await this.request("/auth/sessions/revoke-others", {
        method: "POST",
      });
      if (!response.ok) throw new Error("unable to revoke sessions");
    },
    async deleteAccount(password: string) {
      const response = await this.request("/auth/account/delete", {
        body: JSON.stringify({ password }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("account deletion failed");
      const vault = useVaultStore();
      await vault.lock();
      this.isAuthenticated = false;
      this.userId = null;
      this.email = null;
    },
  },
});
