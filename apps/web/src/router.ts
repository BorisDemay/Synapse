import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  type Router,
} from "vue-router";

import ActivateView from "./views/ActivateView.vue";
import AdminView from "./views/AdminView.vue";
import LoginView from "./views/LoginView.vue";
import RegisterView from "./views/RegisterView.vue";
import UnlockVaultView from "./views/UnlockVaultView.vue";
import VaultView from "./views/VaultView.vue";

export interface AuthenticationState {
  isAdmin?: boolean;
  isAuthenticated: boolean;
  isLocalMode?: boolean;
}

export interface VaultAccessState {
  hasEncryptedVault: boolean;
  isUnlocked: boolean;
}

export function createAppRouter(
  auth: AuthenticationState,
  vault: VaultAccessState,
  options: { memory?: boolean } = {},
): Router {
  const router = createRouter({
    history: options.memory ? createMemoryHistory() : createWebHistory(),
    routes: [
      { component: LoginView, path: "/login" },
      { component: RegisterView, path: "/register" },
      { component: ActivateView, path: "/activate" },
      { component: AdminView, path: "/admin" },
      { component: UnlockVaultView, path: "/unlock" },
      {
        component: VaultView,
        path: "/vault",
      },
      { path: "/:pathMatch(.*)*", redirect: "/vault" },
    ],
  });

  router.beforeEach((to) => {
    if (to.path === "/activate") return true;
    // An administrator account can manage users without owning an unlocked
    // vault, so it is the default landing place instead of the unlock screen.
    const home = vault.isUnlocked
      ? "/vault"
      : auth.isAdmin
        ? "/admin"
        : "/unlock";
    if (to.path === "/login" || to.path === "/register") {
      if (auth.isAuthenticated || auth.isLocalMode) {
        return home;
      }
      return true;
    }
    if (to.path === "/admin") {
      if (!auth.isAuthenticated && !auth.isLocalMode)
        return { path: "/login", query: { redirect: to.fullPath } };
      return auth.isAdmin ? true : home;
    }
    if (!auth.isAuthenticated && !auth.isLocalMode) {
      // La destination d'origine (lien profond vers une note) survit à la
      // connexion et au déverrouillage.
      return { path: "/login", query: { redirect: to.fullPath } };
    }
    if (to.path !== "/unlock" && !vault.isUnlocked) {
      return { path: "/unlock", query: { redirect: to.fullPath } };
    }
    return true;
  });

  return router;
}
