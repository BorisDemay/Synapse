import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  type Router,
} from "vue-router";

import LoginView from "./views/LoginView.vue";
import RegisterView from "./views/RegisterView.vue";
import UnlockVaultView from "../../web/src/views/UnlockVaultView.vue";
import VaultView from "../../web/src/views/VaultView.vue";

export interface AuthenticationState {
  isAuthenticated: boolean;
}

export interface VaultAccessState {
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
      { component: UnlockVaultView, path: "/unlock" },
      { component: VaultView, path: "/vault" },
      { path: "/:pathMatch(.*)*", redirect: "/vault" },
    ],
  });
  router.beforeEach((to) => {
    if (to.path === "/login" || to.path === "/register") {
      if (auth.isAuthenticated) {
        return vault.isUnlocked ? "/vault" : "/unlock";
      }
      return true;
    }
    if (!auth.isAuthenticated) {
      return "/login";
    }
    if (to.path !== "/unlock" && !vault.isUnlocked) {
      return "/unlock";
    }
    return true;
  });
  return router;
}
