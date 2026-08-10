import { defineStore } from "pinia";

import {
  clearRememberedSession,
  getRememberedSessionUser,
  rememberSessionUser,
} from "../offline/cache";
import { useVaultStore } from "./vault";

interface LoginCredentials {
  email: string;
  password: string;
}

interface RegisterInput {
  email: string;
  invitationToken?: string;
  password: string;
}

function csrfHeaders(): HeadersInit {
  return {
    Origin: window.location.origin,
  };
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    isAuthenticated: false,
    isOfflineSession: false,
    userId: null as string | null,
  }),
  actions: {
    async restoreSession() {
      try {
        const response = await fetch("/v1/session", {
          credentials: "include",
        });
        if (!response.ok) {
          this.isAuthenticated = false;
          this.isOfflineSession = false;
          this.userId = null;
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
          return false;
        }
        this.isAuthenticated = true;
        this.isOfflineSession = true;
        this.userId = remembered;
        return true;
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
    async login(email: string, password: string) {
      const credentials: LoginCredentials = { email, password };
      const response = await fetch("/auth/login", {
        body: JSON.stringify(credentials),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Authentication failed");
      }
      this.isAuthenticated = true;
      await this.restoreSession();
    },
    async logout() {
      const vault = useVaultStore();
      vault.lock();
      try {
        const response = await fetch("/auth/logout", {
          credentials: "include",
          headers: csrfHeaders(),
          method: "POST",
        });
        if (!response.ok) {
          throw new Error("Logout failed");
        }
      } finally {
        this.isAuthenticated = false;
        this.isOfflineSession = false;
        this.userId = null;
        await clearRememberedSession();
      }
    },
  },
});
