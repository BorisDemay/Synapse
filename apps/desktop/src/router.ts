import { createRouter, createWebHistory } from "vue-router";

import LoginView from "./views/LoginView.vue";
import RegisterView from "./views/RegisterView.vue";
import UnlockView from "./views/UnlockView.vue";
import VaultView from "./views/VaultView.vue";
import WelcomeView from "./views/WelcomeView.vue";

export function createAppRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { component: WelcomeView, path: "/" },
      { component: VaultView, path: "/vault" },
      { component: LoginView, path: "/login" },
      { component: RegisterView, path: "/register" },
      { component: UnlockView, path: "/unlock" },
      { path: "/:pathMatch(.*)*", redirect: "/" },
    ],
  });
}
