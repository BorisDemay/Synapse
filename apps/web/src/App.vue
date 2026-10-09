<script setup lang="ts">
import { UpdateBanner } from "@synapse/ui";
import { RouterView } from "vue-router";

import { webUpdateCoordinator } from "./update/web-updates";
import ToastHost from "./notifications/ToastHost.vue";
</script>

<template>
  <ToastHost>
    <UpdateBanner :coordinator="webUpdateCoordinator" />
  </ToastHost>
  <RouterView />
</template>
