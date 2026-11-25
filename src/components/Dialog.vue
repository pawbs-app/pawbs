<script setup lang="ts">
/* A bracketed modal on a dimmed backdrop. Esc and the backdrop close it. The keyboard stays inside it
   while it is open (Tab goes round its controls, never to the page underneath), and goes back to
   whatever opened it when it closes. */
import { nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Icon from './Icon.vue'
import { isTyping, KeyLevel, useKeyLayer } from '@/services/keyboard'
import { onBack } from '@/services/backClose'

const props = withDefaults(defineProps<{ title: string; wide?: boolean; dismissable?: boolean }>(), { dismissable: true })
const emit = defineEmits<{ close: [] }>()
const box = ref<HTMLElement | null>(null)

useKeyLayer((e) => {
  if (e.key === 'Escape') {
    if (props.dismissable) emit('close')
    return true
  }
  // Shortcuts of the views underneath stay quiet while the dialog is open; fields and buttons
  // inside it keep their own keys.
  if (isTyping(e.target) || ['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown'].includes(e.key)) return false
  return !e.ctrlKey && !e.metaKey && !e.altKey
}, true, KeyLevel.Dialog)

/* A press and its release both on the backdrop close the dialog. On the release, not the press: on
   a touch screen the click comes after the finger lifts, and with the dialog already gone it landed
   on whatever was underneath. Both, so that a text selection dragged out of the dialog does not. */
let pressedOutside = false
function onBackdropDown(e: PointerEvent) {
  pressedOutside = e.target === e.currentTarget
}
function onBackdropClick() {
  if (pressedOutside && props.dismissable) emit('close')
  pressedOutside = false
}

/* Back closes it too, and stays on the page (services/backClose): on a phone it is the way out of
   anything, and it used to leave the page with the dialog still open over the next one. One that
   cannot be closed yet (busy) stays, and keeps its hold on the next Back. */
let dropBack: (() => void) | null = null
function backClose() {
  dropBack = null
  if (props.dismissable) emit('close')
  else dropBack = onBack(backClose)
}

/* Nor left open over another page: going to one (a link inside it) closes it. The gallery opening or
   stepping (only `post` changes) does not. */
const route = useRoute()
watch(
  () => route.path,
  () => props.dismissable && emit('close'),
)
onDeactivated(() => props.dismissable && emit('close'))

let opener: HTMLElement | null = null
onMounted(async () => {
  dropBack = onBack(backClose)
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  await nextTick()
  const first = box.value?.querySelector<HTMLElement>('[autofocus], input, textarea, select, button.rv-btn--primary')
  // Nothing to start on (a dialog still loading): the dialog itself, so Tab starts from inside it.
  ;(first ?? box.value)?.focus()
})
onBeforeUnmount(() => {
  dropBack?.()
  // (A menu entry that opened it is gone by now: nothing to go back to.)
  if (opener?.isConnected && box.value?.contains(document.activeElement)) opener.focus({ preventScroll: true })
})

function controls(): HTMLElement[] {
  if (!box.value) return []
  return [...box.value.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
  )
}
function keepInside(e: KeyboardEvent) {
  if (e.key !== 'Tab') return
  const list = controls()
  if (!list.length) return e.preventDefault()
  const first = list[0]
  const last = list[list.length - 1]
  const at = document.activeElement
  if (e.shiftKey ? at === first || at === box.value : at === last) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="dlg-backdrop rv-backdrop" @pointerdown="onBackdropDown" @click.self="onBackdropClick">
      <div ref="box" class="rv-dialog rv-brackets" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @keydown="keepInside">
        <header>
          <span class="rv-label">{{ title }}</span>
          <button class="rv-icon-btn" type="button" title="Close (Esc)" :disabled="!dismissable" @click="emit('close')"><Icon name="close" /></button>
        </header>
        <div class="dlg-body"><slot /></div>
        <footer v-if="$slots.footer"><slot name="footer" /></footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dlg-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  padding: 16px;
  overflow-y: auto;
}
.rv-dialog:focus {
  outline: none;
}
.rv-dialog.wide {
  width: min(760px, calc(100vw - 32px));
}
.dlg-body {
  display: grid;
  gap: 12px;
}
/* A phone (640px wide or less): a bottom sheet, full width, as tall as it needs up to most of the
   screen (then its inside scrolls), above the home indicator. */
@media (max-width: 640px) {
  .dlg-backdrop {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 0;
  }
  .rv-dialog,
  .rv-dialog.wide {
    width: 100%;
    max-height: 92dvh;
    overflow-y: auto;
    overscroll-behavior: contain;
    border-width: 1px 0 0;
    padding-bottom: calc(18px + env(safe-area-inset-bottom));
  }
  .rv-dialog > header {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg);
    min-height: 48px;
  }
  .rv-dialog > header .rv-icon-btn {
    width: 48px;
    height: 48px;
  }
}
</style>
