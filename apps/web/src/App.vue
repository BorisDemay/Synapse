<script setup lang="ts">
import { UpdateBanner } from "@synapse/ui";
import { RouterView } from "vue-router";

import { webUpdateCoordinator } from "./update/web-updates";
</script>

<template>
  <UpdateBanner :coordinator="webUpdateCoordinator" />
  <RouterView />
</template>
