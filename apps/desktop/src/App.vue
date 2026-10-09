<script setup lang="ts">
import { UpdateBanner } from "@synapse/ui";

import TitleBar from "./components/TitleBar.vue";
import ToastHost from "../../web/src/notifications/ToastHost.vue";
import { desktopUpdateCoordinator } from "./update/desktop-updates";
</script>

<template>
  <div class="desktop-frame">
    <TitleBar />
    <ToastHost>
      <UpdateBanner :coordinator="desktopUpdateCoordinator" />
    </ToastHost>
    <div class="desktop-body">
      <RouterView />
    </div>
  </div>
</template>
