<script setup lang="ts">
/* The loading indicator: a bracketed barber pole (styles in app.css, shared with the boot screen). */
defineProps<{ label?: string }>()
</script>

<template>
  <div class="pole rv-brackets" role="progressbar" :aria-label="label ?? 'Loading'" aria-busy="true">
    <span class="stripes"></span>
  </div>
</template>
