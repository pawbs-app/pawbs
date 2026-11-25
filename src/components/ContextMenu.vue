<script setup lang="ts">
/* The open right-click menu (services/contextMenu). At the pointer, kept on screen; mouse, touch or
   keys: arrows, Home / End, Enter, Esc, or the shortcut letter shown on an item. A click elsewhere,
   a scroll, a resize or a route change closes it. */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Icon from './Icon.vue'
import { closeMenu, menu, openInNewTab, resolveEntries, type MenuItem, type OpenMenu } from '@/services/contextMenu'
import { KeyLevel, pushKeyLayer } from '@/services/keyboard'
import { onBack } from '@/services/backClose'
import { phone } from '@/composables/phone'

/* On a phone (640px wide or less) the menu is a bottom sheet: full width, rows a thumb can hit, a
   backdrop that takes the tap outside (closing on it let the tap land on the page), Back closes it. */
const sheet = computed(() => phone.value)
let dropBack: (() => void) | null = null

const route = useRoute()
const box = ref<HTMLElement | null>(null)
const pos = ref({ left: 0, top: 0 })
const active = ref(-1)
let dropKeys: (() => void) | null = null

// Resolved while open: entries that depend on a lookup appear when it is done.
const items = computed(() => resolveEntries(menu.value?.entries ?? []))
const entries = () => items.value
function usable(i: number) {
  const e = entries()[i]
  return !!e && e !== 'sep' && !e.disabled
}

function run(e: MenuItem, ev?: MouseEvent) {
  if (e.disabled) return
  closeMenu()
  if (e.href && ev && (ev.ctrlKey || ev.metaKey)) return openInNewTab(e.href)
  void e.run()
}
/** A middle click on an item that goes somewhere: there, in a new tab. */
function aux(e: MenuItem, ev: MouseEvent) {
  if (ev.button !== 1 || !e.href || e.disabled) return
  ev.preventDefault()
  closeMenu()
  openInNewTab(e.href)
}

function move(dir: 1 | -1) {
  const n = entries().length
  let i = active.value
  for (let k = 0; k < n; k++) {
    i = (i + dir + n) % n
    if (usable(i)) {
      active.value = i
      void nextTick(() => box.value?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.focus())
      return
    }
  }
}

function onKey(e: KeyboardEvent): boolean {
  switch (e.key) {
    case 'Escape':
      closeMenu()
      return true
    case 'ArrowDown':
      move(1)
      return true
    case 'ArrowUp':
      move(-1)
      return true
    case 'Home':
      active.value = -1
      move(1)
      return true
    case 'End':
      active.value = entries().length
      move(-1)
      return true
    case 'Enter':
    case ' ': {
      const item = entries()[active.value]
      if (item && item !== 'sep') run(item)
      return true
    }
    case 'Tab':
      closeMenu()
      return true
  }
  // The shortcut shown on an item runs it from the menu too.
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const item = entries().find((x): x is MenuItem => x !== 'sep' && !x.disabled && x.hint?.toLowerCase() === e.key.toLowerCase())
    if (item) run(item)
  }
  return true // nothing reaches the page underneath while the menu is open
}

function onOutside(e: Event) {
  // (The sheet's backdrop closes it on its own click, after the finger lifts.)
  if ((e.target as Element | null)?.classList?.contains('ctx-backdrop')) return
  if (box.value && !box.value.contains(e.target as Node)) closeMenu()
}
function onScroll(e: Event) {
  if (!box.value?.contains(e.target as Node)) closeMenu()
}
function teardown() {
  dropKeys?.()
  dropKeys = null
  dropBack?.()
  dropBack = null
  window.removeEventListener('pointerdown', onOutside, true)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', closeMenu)
  window.removeEventListener('blur', closeMenu)
}

/** What had the keyboard when the menu opened: it gets it back when the menu closes without going
    anywhere (Escape, an entry that only changes something), instead of leaving it on nothing. */
let opener: HTMLElement | null = null
watch(menu, async (m) => {
  teardown()
  if (!m) {
    const back = opener
    opener = null
    const at = document.activeElement
    if (back?.isConnected && (!at || at === document.body || !!box.value?.contains(at))) back.focus({ preventScroll: true })
    return
  }
  const at = document.activeElement
  if (!opener && at instanceof HTMLElement && at !== document.body && !box.value?.contains(at)) opener = at
  active.value = -1
  pos.value = { left: m.x, top: m.y }
  await nextTick()
  // Replaced (or closed) meanwhile: the newer run sets things up; a second key layer from this one
  // would never be dropped, and would swallow every key.
  if (menu.value !== m) return
  const el = box.value
  if (!el) return
  place(m)
  el.focus({ preventScroll: true })
  dropKeys = pushKeyLayer(onKey, true, KeyLevel.Menu)
  if (sheet.value) dropBack = onBack(closeMenu)
  window.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', closeMenu)
  window.addEventListener('blur', closeMenu)
})
/** Keep it on screen: to the left of the pointer near the right edge, slid up near the bottom. */
function place(m: OpenMenu) {
  const el = box.value
  if (!el || sheet.value) return
  const r = el.getBoundingClientRect()
  const pad = 6
  const left = m.x + r.width > innerWidth - pad ? Math.max(pad, m.x - r.width) : m.x
  const top = m.y + r.height > innerHeight - pad ? Math.max(pad, innerHeight - pad - r.height) : m.y
  pos.value = { left, top }
}
// Entries arriving later make it taller (or wider): placed again.
watch(
  () => items.value.map((e) => (e === 'sep' ? '-' : e.label)).join('|'),
  async () => {
    const m = menu.value
    if (!m) return
    await nextTick()
    place(m)
  },
)
watch(() => route.fullPath, closeMenu)
onBeforeUnmount(teardown)
</script>

<template>
  <Teleport to="body">
    <div v-if="menu && sheet" class="ctx-backdrop rv-backdrop" @click="closeMenu" @contextmenu.prevent></div>
    <div
      v-if="menu"
      ref="box"
      class="rv-menu ctx"
      :class="{ 'is-sheet': sheet }"
      role="menu"
      tabindex="-1"
      :aria-label="menu.title ?? 'Menu'"
      :style="sheet ? undefined : { left: pos.left + 'px', top: pos.top + 'px' }"
      @contextmenu.prevent
    >
      <span v-if="sheet" class="ctx-handle" aria-hidden="true"></span>
      <div v-if="menu.title" class="ctx-title rv-label">{{ menu.title }}</div>
      <template v-for="(e, i) in items" :key="i">
        <div v-if="e === 'sep'" class="ctx-sep" role="separator"></div>
        <button
          v-else
          class="ctx-item"
          :class="{ danger: e.danger, 'is-active': i === active }"
          type="button"
          :role="e.checked === undefined ? 'menuitem' : 'menuitemcheckbox'"
          :aria-checked="e.checked === undefined ? undefined : e.checked"
          :data-i="i"
          :disabled="e.disabled"
          @click="run(e, $event)"
          @auxclick="aux(e, $event)"
          @mousedown.middle.prevent
          @pointerenter="active = i"
        >
          <span class="ctx-ico"><Icon v-if="e.checked" name="check" :size="14" /><Icon v-else-if="e.icon" :name="e.icon" :size="14" /></span>
          <span class="ctx-label">{{ e.label }}</span>
          <kbd v-if="e.hint && !sheet" class="ctx-hint">{{ e.hint }}</kbd>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx {
  position: fixed;
  z-index: 400;
  min-width: 230px;
  max-width: min(340px, calc(100vw - 12px));
  /* Never taller than the screen: a long menu (a video's, on a phone held sideways) scrolls, or its
     last entries (Close, Slideshow) were out of reach. */
  max-height: calc(100dvh - 12px);
  overflow-y: auto;
  overscroll-behavior: contain;
  box-shadow: 0 12px 32px var(--scrim-62);
  outline: none;
  animation: ctx-in 0.08s ease-out;
}
@keyframes ctx-in {
  from {
    opacity: 0;
  }
}
.ctx-title {
  padding: 5px 12px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--line);
  margin-bottom: 4px;
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 12px;
  border: 0;
  text-align: left;
  color: var(--text);
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  outline: none;
}
.ctx-item.is-active:not(:disabled) {
  background: var(--hover);
}
.ctx-item:disabled {
  opacity: 0.4;
}
.ctx-item.danger {
  color: var(--bad);
}
.ctx-ico {
  width: 14px;
  flex: none;
  display: grid;
  place-items: center;
  color: var(--text-2);
}
.ctx-item.danger .ctx-ico {
  color: inherit;
}
.ctx-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ctx-hint {
  font: inherit;
  font-size: 0.625rem;
  color: var(--text-3);
  border: 1px solid var(--line-2);
  padding: 0 4px;
  letter-spacing: 0.04em;
}
.ctx-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--line);
}
@media (pointer: coarse) {
  .ctx-item {
    min-height: 44px;
  }
  .ctx-hint {
    display: none;
  }
}
/* The phone's sheet (components/Sheet's look): from the bottom, full width, its top corners bracketed. */
.ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 399;
  animation: ctx-in 0.2s ease-out;
}
.ctx.is-sheet {
  --bc: var(--text);
  --bs: 12px;
  left: 0;
  right: 0;
  bottom: 0;
  top: auto;
  width: 100%;
  min-width: 0;
  max-width: none;
  max-height: 78dvh;
  border-width: 1px 0 0;
  border-color: var(--line-2);
  padding: 0 0 calc(8px + env(safe-area-inset-bottom));
  box-shadow: none;
  animation: ctx-rise 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
  background-image:
    linear-gradient(var(--bc), var(--bc)) top left / var(--bs) 1px no-repeat,
    linear-gradient(var(--bc), var(--bc)) top left / 1px var(--bs) no-repeat,
    linear-gradient(var(--bc), var(--bc)) top right / var(--bs) 1px no-repeat,
    linear-gradient(var(--bc), var(--bc)) top right / 1px var(--bs) no-repeat;
}
@keyframes ctx-rise {
  from {
    transform: translateY(100%);
  }
}
.ctx-handle {
  display: block;
  width: 36px;
  height: 3px;
  margin: 8px auto 2px;
  background: var(--line-3);
}
.is-sheet .ctx-title {
  padding: 12px 16px 12px;
  margin-bottom: 0;
}
.is-sheet .ctx-item {
  min-height: 52px;
  gap: 14px;
  padding: 6px 16px;
  font-size: 0.75rem;
}
.is-sheet .ctx-ico {
  width: 18px;
}
.is-sheet .ctx-ico :deep(svg) {
  width: 18px;
  height: 18px;
}
.is-sheet .ctx-sep {
  margin: 6px 16px;
}
@media (prefers-reduced-motion: reduce) {
  .ctx.is-sheet,
  .ctx-backdrop {
    animation: none;
  }
}
</style>
