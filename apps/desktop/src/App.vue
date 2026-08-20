<script setup lang="ts">
import TitleBar from "./components/TitleBar.vue";
</script>

<template>
  <div class="desktop-frame">
    <TitleBar />
    <div class="desktop-body">
      <RouterView />
    </div>
  </div>
</template>
