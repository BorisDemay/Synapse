<script setup lang="ts">
import { UPDATE_COORDINATOR_KEY, UpdateBanner } from "@synapse/ui";
import { provide } from "vue";
import { RouterView } from "vue-router";

import { webUpdateCoordinator } from "./update/web-updates";
import ToastHost from "./notifications/ToastHost.vue";

provide(UPDATE_COORDINATOR_KEY, webUpdateCoordinator);
</script>

<template>
  <ToastHost>
    <UpdateBanner :coordinator="webUpdateCoordinator" />
  </ToastHost>
  <RouterView />
</template>
