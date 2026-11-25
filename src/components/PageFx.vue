<script setup lang="ts">
/* A new page fades up (styles/fx.css, interface effects): <main> replays a short fade when the page
   changes. A page is its path (and a search its query: new results), not the viewer opening over
   it, nor a section of Settings. Renders nothing. */
import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const page = computed(() => {
  if (route.name === 'settings') return '/settings'
  if (route.name === 'posts') return `/posts?${route.query.q ?? ''}`
  return route.path
})
function replay() {
  const main = document.querySelector<HTMLElement>('main.main')
  if (!main) return
  main.classList.remove('fx-page')
  void main.offsetWidth // restart the animation
  main.classList.add('fx-page')
}
watch(page, (_, old) => old !== undefined && replay())
onMounted(replay)
defineExpose({ replay })
</script>

<template>
  <span hidden></span>
</template>
