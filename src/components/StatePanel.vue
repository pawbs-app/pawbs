<script setup lang="ts">
/* A bracketed panel for moments with nothing to show: loading, empty, failure. */
import LoadingPole from './LoadingPole.vue'
defineProps<{ label: string; message?: string; alert?: boolean; loading?: boolean }>()
</script>

<template>
  <div class="rv-panel rv-brackets" :class="{ 'rv-panel--alert': alert }" role="status">
    <div class="rv-label" :class="{ 'rv-label--bad': alert }">{{ label }}</div>
    <LoadingPole v-if="loading" :label="label" />
    <p v-if="message" class="msg rv-selectable">{{ message }}</p>
    <slot />
    <div v-if="$slots.actions" class="row"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.rv-panel {
  width: min(520px, calc(100vw - 32px));
  min-width: 0;
}
.msg {
  color: var(--text-2);
}
</style>
