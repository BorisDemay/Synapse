<template>
  <div class="app-shell">
    <aside aria-label="Navigation du coffre">
      <slot name="navigation" />
    </aside>
    <main>
      <slot />
    </main>
  </div>
</template>
