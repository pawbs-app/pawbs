<script setup lang="ts">
/* Pull down at the top of a page (touch screens) to reload it. A bracketed tab follows the finger
   under the title bar; past the line it says so, and on release it goes and the page reloads
   (services/refresh), showing its own loading. Only on pages that can reload, only at the very
   top, never over the gallery or a dialog, and only for a drag that goes down more than sideways. */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import { currentRefresh, type RefreshHandler } from '@/services/refresh'
import { freshAnswers } from '@/api/client'

const THRESHOLD = 64 // px the tab travels before a release reloads
const MAX = 96
/** "At the top" allows for the fraction of a pixel high-density screens can leave. */
const SLACK = 2

const pull = ref(0)
const state = ref<'idle' | 'pulling' | 'back'>('idle')

let start: { x: number; y: number } | null = null
let decided = false
let handler: RefreshHandler | null = null

const atTop = () => window.scrollY <= SLACK

function blocked(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  const main = document.querySelector('main.main')
  if (!el || !main || !main.contains(el) || main.hasAttribute('inert')) return true
  if (document.querySelector('.rv-backdrop, [aria-modal="true"]')) return true
  return !!el.closest('input, textarea, select, [contenteditable="true"]')
}

function onStart(e: TouchEvent) {
  if (busy || e.touches.length !== 1 || !atTop() || blocked(e.target)) return
  handler = currentRefresh()
  if (!handler) return
  start = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  decided = false
}
function onMove(e: TouchEvent) {
  if (!start) return
  const t = e.touches[0]
  const dx = t.clientX - start.x
  const dy = t.clientY - start.y
  if (!decided) {
    if (Math.hypot(dx, dy) < 10) return
    // Down, and more down than sideways: a pull. Anything else is left to the page.
    if (dy <= 0 || Math.abs(dx) > dy || !atTop()) {
      start = null
      return
    }
    decided = true
    state.value = 'pulling'
  }
  // The gesture is ours from here. Left to the browser, it is taken as a scroll at the top of the
  // page: Android's browsers then stop telling the page where the finger is, or cancel the touch,
  // and the pull never got far enough to reload.
  if (e.cancelable) e.preventDefault()
  // Harder the further it goes.
  pull.value = Math.min(MAX, Math.max(0, dy) * 0.5)
}
/** A reload is under way: no new pull until it is done. */
let busy = false
async function onEnd() {
  if (!start) return
  start = null
  if (state.value !== 'pulling') return
  const run = pull.value >= THRESHOLD ? handler : null
  // The tab goes as soon as the reload starts: the page shows its own loading (one loader, not two).
  cancel()
  if (!run) return
  busy = true
  freshAnswers()
  try {
    await run()
  } catch {
    /* the page shows its own error */
  } finally {
    busy = false
  }
}
function cancel() {
  start = null
  state.value = 'back'
  pull.value = 0
  window.setTimeout(() => state.value === 'back' && (state.value = 'idle'), 200)
}
/** The browser took the touch away: a pull in progress springs back (a reload already started goes on). */
function onCancel() {
  if (state.value === 'pulling') cancel()
  else start = null
}

/* The move listener can stop the browser's own handling of the gesture, so the browser waits for it
   on every move it is attached for: it is attached only while the page is at its top (where a pull
   can start), and the scroll anywhere else stays free. */
let blocking = false
let syncQueued = 0
function syncBlocking() {
  syncQueued = 0
  const want = atTop()
  if (want === blocking) return
  blocking = want
  if (want) document.addEventListener('touchmove', onMove, { passive: false })
  else if (!start) document.removeEventListener('touchmove', onMove)
  else blocking = true // a pull in progress keeps it until it ends
}
const onScroll = () => {
  if (!syncQueued) syncQueued = requestAnimationFrame(syncBlocking)
}

onMounted(() => {
  document.addEventListener('touchstart', onStart, { passive: true })
  document.addEventListener('touchend', onEnd, { passive: true })
  document.addEventListener('touchcancel', onCancel, { passive: true })
  window.addEventListener('scroll', onScroll, { passive: true })
  syncBlocking()
})
onBeforeUnmount(() => {
  document.removeEventListener('touchstart', onStart)
  document.removeEventListener('touchmove', onMove)
  document.removeEventListener('touchend', onEnd)
  document.removeEventListener('touchcancel', onCancel)
  window.removeEventListener('scroll', onScroll)
  cancelAnimationFrame(syncQueued)
})
</script>

<template>
  <div
    v-if="state !== 'idle'"
    class="ptr rv-brackets"
    :class="{ ready: pull >= THRESHOLD, back: state === 'back' }"
    :style="{ transform: `translate(-50%, ${pull - 44}px)`, opacity: Math.min(1, pull / 32) }"
    role="status"
    aria-label="Pull to reload"
  >
    <Icon name="arrow-down" class="arrow" />
    <span class="lbl">{{ pull >= THRESHOLD ? 'Release to reload' : 'Pull to reload' }}</span>
  </div>
</template>

<style scoped>
.ptr {
  --bc: var(--text-2);
  --bs: 7px;
  position: fixed;
  left: 50%;
  top: calc(var(--bar-h) + env(safe-area-inset-top));
  z-index: 45;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 180px;
  height: 36px;
  padding: 0 12px;
  background-color: var(--bg);
  font-size: 0.625rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-2);
  pointer-events: none;
}
.ptr.back {
  transition:
    transform 0.2s,
    opacity 0.2s;
}
.ptr.ready {
  --bc: var(--text);
  color: var(--text);
}
.arrow {
  transition: transform 0.15s;
}
.ptr.ready .arrow {
  transform: rotate(180deg);
}
</style>
