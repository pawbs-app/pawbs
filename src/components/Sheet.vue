<script setup lang="ts">
/* A bottom sheet: the phone's menu (More, a page's actions, the sites). It rises from the bottom on
   a dimmed backdrop, square and black like the rest, its top edge a hairline with bracket corners
   and a grab handle. A tap outside, a drag down, Esc or Back closes it; the keyboard stays inside
   while it is open and goes back to what opened it. Rows inside use `.sheet-row` (52px tall). */
import { nextTick, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Icon from './Icon.vue'
import { KeyLevel, useKeyLayer } from '@/services/keyboard'
import { onBack } from '@/services/backClose'

const props = defineProps<{ open: boolean; title?: string }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)

useKeyLayer((e) => {
  if (!props.open) return false
  if (e.key === 'Escape') {
    emit('close')
    return true
  }
  return false
}, true, KeyLevel.Dialog)

let dropBack: (() => void) | null = null
let opener: HTMLElement | null = null
watch(
  () => props.open,
  async (on) => {
    dropBack?.()
    dropBack = null
    if (on) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dropBack = onBack(() => emit('close'))
      await nextTick()
      panel.value?.focus({ preventScroll: true })
    } else {
      const back = opener
      opener = null
      if (back?.isConnected) back.focus({ preventScroll: true })
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => dropBack?.())
/* Never left open over another page (one kept alive behind it, say): the page changing closes it. */
const route = useRoute()
watch(
  () => route.fullPath,
  () => props.open && emit('close'),
)
onDeactivated(() => props.open && emit('close'))

/* A press and its release both on the backdrop close it: on the release (a touch's click comes after
   the finger lifts; closing on the press let that click land on the page underneath). */
let pressedOutside = false
function onBackdropDown(e: PointerEvent) {
  pressedOutside = e.target === e.currentTarget
}
function onBackdropClick() {
  if (pressedOutside) emit('close')
  pressedOutside = false
}

/* Dragged down by its handle or title: it follows the finger, and closes past a quarter of its
   height (or a quick flick), else settles back. */
const drag = ref(0)
let startY = 0
let startT = 0
let dragging = false
function onDragStart(e: PointerEvent) {
  dragging = true
  startY = e.clientY
  startT = performance.now()
  drag.value = 0
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onDragMove(e: PointerEvent) {
  if (!dragging) return
  drag.value = Math.max(0, e.clientY - startY)
}
function onDragEnd() {
  if (!dragging) return
  dragging = false
  const h = panel.value?.offsetHeight ?? 400
  const fast = drag.value > 40 && drag.value / Math.max(1, performance.now() - startT) > 0.6
  if (drag.value > h / 4 || fast) emit('close')
  drag.value = 0
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="sheet-backdrop rv-backdrop" @pointerdown="onBackdropDown" @click.self="onBackdropClick">
        <div
          ref="panel"
          class="rv-sheet"
          role="dialog"
          aria-modal="true"
          :aria-label="title ?? 'Menu'"
          tabindex="-1"
          :style="drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined"
        >
          <div class="grip" @pointerdown="onDragStart" @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragEnd">
            <span class="handle" aria-hidden="true"></span>
            <header v-if="title">
              <span class="rv-label">{{ title }}</span>
              <button class="rv-icon-btn" type="button" title="Close" aria-label="Close" @click="emit('close')"><Icon name="close" /></button>
            </header>
          </div>
          <div class="sheet-body"><slot /></div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 210;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.rv-sheet {
  --bc: var(--text);
  --bs: 12px;
  position: relative;
  width: min(560px, 100%);
  max-height: 86dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border-top: 1px solid var(--line-2);
  padding-bottom: env(safe-area-inset-bottom);
  outline: none;
  transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}
/* The top corners carry the HUD's brackets (the bottom is the screen's edge). */
.rv-sheet::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -1px;
  height: var(--bs);
  pointer-events: none;
  background:
    linear-gradient(var(--bc), var(--bc)) top left / var(--bs) 1px no-repeat,
    linear-gradient(var(--bc), var(--bc)) top left / 1px var(--bs) no-repeat,
    linear-gradient(var(--bc), var(--bc)) top right / var(--bs) 1px no-repeat,
    linear-gradient(var(--bc), var(--bc)) top right / 1px var(--bs) no-repeat;
}
.grip {
  flex: none;
  touch-action: none;
  cursor: grab;
}
.handle {
  display: block;
  width: 36px;
  height: 3px;
  margin: 8px auto 2px;
  background: var(--line-3);
}
header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 4px 0 16px;
  border-bottom: 1px solid var(--line);
}
header .rv-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
header .rv-icon-btn {
  width: 44px;
  height: 44px;
}
.sheet-body {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: 8px;
}
/* Rows: a whole row to tap (52px), an icon, a label in the system's small capitals, a sub line. */
.sheet-body :deep(.sheet-row) {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 52px;
  padding: 6px 16px;
  border: 0;
  background: none;
  color: var(--text);
  text-align: left;
  text-decoration: none;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.sheet-body :deep(.sheet-row:disabled) {
  opacity: 0.4;
}
.sheet-body :deep(.sheet-row .rv-icon) {
  flex: none;
  color: var(--text-2);
}
.sheet-body :deep(.sheet-row.is-on .rv-icon) {
  color: var(--text);
}
.sheet-body :deep(.sheet-row .grow) {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}
.sheet-body :deep(.sheet-row .sub) {
  color: var(--text-3);
  font-size: 0.625rem;
  letter-spacing: 0.06em;
  text-transform: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sheet-body :deep(.sheet-sep) {
  height: 1px;
  margin: 6px 16px;
  background: var(--line);
}
.sheet-body :deep(.sheet-label) {
  padding: 12px 16px 4px;
}

/* In: the backdrop dims, the sheet rises; out the same way, quicker. */
.sheet-enter-active,
.sheet-leave-active {
  transition: background-color 0.22s ease-out;
}
.sheet-enter-active .rv-sheet {
  transition: transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.sheet-leave-active .rv-sheet {
  transition: transform 0.18s cubic-bezier(0.6, 0, 0.8, 0.4);
}
.sheet-enter-from,
.sheet-leave-to {
  background-color: transparent;
}
.sheet-enter-from .rv-sheet,
.sheet-leave-to .rv-sheet {
  transform: translateY(100%);
}
@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active,
  .sheet-leave-active,
  .sheet-enter-active .rv-sheet,
  .sheet-leave-active .rv-sheet {
    transition: none;
  }
}
:root[data-fx='off'] .sheet-enter-active,
:root[data-fx='off'] .sheet-leave-active,
:root[data-fx='off'] .sheet-enter-active .rv-sheet,
:root[data-fx='off'] .sheet-leave-active .rv-sheet {
  transition: none;
}
</style>
