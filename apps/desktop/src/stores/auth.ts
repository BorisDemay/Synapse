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
      localStorage.setItem(INSTANCE_URL_KEY, url);
      return origin;
    },
    async ensureInstance() {
      if (!this.instanceUrl.trim()) {
        throw new Error("Instance URL missing");
      }
      await this.configureInstance(this.instanceUrl.trim());
    },
    async restoreSession() {
      try {
        await this.ensureInstance();
        const session = await invoke<{ user_id: string } | null>(
          "auth_session",
        );
        if (!session) {
          this.isAuthenticated = false;
          this.userId = null;
          return false;
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
        await this.ensureInstance();
        return await invoke<boolean>("auth_public_signup");
      } catch {
        return false;
      }
    },
    async login(email: string, password: string) {
      await this.ensureInstance();
      const session = await invoke<{ user_id: string }>("auth_login", {
        email,
        password,
      });
      this.isAuthenticated = true;
      this.isOfflineSession = false;
      this.userId = session.user_id;
    },
    async register(input: {
      email: string;
      invitationToken?: string;
      password: string;
    }) {
      await this.ensureInstance();
      const session = await invoke<{ user_id: string }>("auth_register", {
        email: input.email,
        invitationToken: input.invitationToken ?? null,
        password: input.password,
      });
      this.isAuthenticated = true;
      this.userId = session.user_id;
    },
    async logout() {
      const vault = useVaultStore();
      await vault.lock();
      try {
        await invoke("auth_logout");
      } finally {
        this.isAuthenticated = false;
        this.userId = null;
        this.email = null;
      }
    },
    async changePassword(currentPassword: string, newPassword: string) {
      await invoke("auth_change_password", {
        currentPassword,
        newPassword,
      });
    },
    async listSessions(): Promise<{ email: string; sessions: AuthSession[] }> {
      const body = await invoke<{
        email: string;
        sessions: Array<{ created_at: string; current: boolean; id: string }>;
      }>("auth_sessions");
      this.email = body.email || null;
      return {
        email: body.email,
        sessions: body.sessions.map((session) => ({
          createdAt: session.created_at,
          current: session.current,
          id: session.id,
        })),
      };
    },
    async revokeSession(sessionId: string) {
      await invoke("auth_revoke_session", { sessionId });
    },
    async revokeOtherSessions() {
      await invoke("auth_revoke_other_sessions");
    },
    async deleteAccount(password: string) {
      await invoke("auth_delete_account", { password });
      const vault = useVaultStore();
      await vault.lock();
      this.isAuthenticated = false;
      this.userId = null;
      this.email = null;
    },
  },
});
