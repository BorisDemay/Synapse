<script setup lang="ts">
import { UpdateBanner } from "@synapse/ui";

import TitleBar from "./components/TitleBar.vue";
import { desktopUpdateCoordinator } from "./update/desktop-updates";
</script>

<template>
  <div class="desktop-frame">
    <TitleBar />
    <UpdateBanner :coordinator="desktopUpdateCoordinator" />
    <div class="desktop-body">
      <RouterView />
    </div>
  </div>
</template>
