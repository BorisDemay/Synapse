<script setup lang="ts">
import { UPDATE_COORDINATOR_KEY, UpdateBanner } from "@synapse/ui";
import { provide } from "vue";

import TitleBar from "./components/TitleBar.vue";
import ToastHost from "../../web/src/notifications/ToastHost.vue";
import { desktopUpdateCoordinator } from "./update/desktop-updates";

provide(UPDATE_COORDINATOR_KEY, desktopUpdateCoordinator);
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
