<script setup lang="ts">
/* Settings › About › Key test (development builds only): what the device sends for the last key
   pressed and released. Some keyboards (on Android tablets notably) send Escape and others under
   unusual names; this shows it. Listened to in the capture phase, so a key the app acts on still
   shows. Two cells of the About list (a dt and its dd). */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const pressed = ref('')
const released = ref('')
function describe(e: KeyboardEvent) {
  const mods = (['ctrlKey', 'altKey', 'metaKey', 'shiftKey'] as const).filter((m) => e[m]).map((m) => m.replace('Key', ''))
  return `${e.key ? JSON.stringify(e.key) : '(no name)'} · code ${e.code || '(none)'} · ${e.keyCode}${mods.length ? ' · ' + mods.join('+') : ''}`
}
function onKey(e: KeyboardEvent) {
  if (e.type === 'keydown') pressed.value = describe(e)
  else released.value = describe(e)
}
onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onKey, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('keyup', onKey, true)
})
</script>

<template>
  <dt>Key test</dt>
  <dd class="rv-selectable tabular">
    <template v-if="pressed || released">
      <span class="line">Pressed: {{ pressed || 'nothing' }}</span>
      <span class="line">Released: {{ released || 'nothing' }}</span>
    </template>
    <span v-else class="faint">Press a key to see what this keyboard sends.</span>
  </dd>
</template>

<style scoped>
.line {
  display: block;
  overflow-wrap: anywhere;
}
</style>
