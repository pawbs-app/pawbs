<script setup lang="ts">
/* A page's "⋯" (phone, at the end of its page head): the head's small icon buttons and the grid's
   layout controls, which the phone hides (app.css), as rows of a sheet with their words. The rows are
   read from the head when the sheet opens, so every page keeps its buttons where they are and adds
   only this; a row presses the button it stands for. A button that should stay in sight on a phone
   carries data-keep. */
import { computed, ref } from 'vue'
import Sheet from './Sheet.vue'
import Icon from './Icon.vue'
import { phone } from '@/composables/phone'
import { useSettings, type Layout } from '@/stores/settings'

const props = defineProps<{ title?: string }>()
const settings = useSettings()
const root = ref<HTMLElement | null>(null)
const open = ref(false)
interface Row {
  label: string
  icon: string
  disabled: boolean
  on: boolean
  el: HTMLElement
}
const rows = ref<Row[]>([])
const hasGrid = ref(false)

function collect() {
  const head = root.value?.closest('.page-head')
  if (!head) return
  rows.value = [...head.querySelectorAll<HTMLElement>(':scope > .rv-icon-btn:not([data-keep])')].map((el) => ({
    label: (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/…$/, '…'),
    icon: el.querySelector('svg')?.outerHTML ?? '',
    disabled: (el as HTMLButtonElement).disabled === true,
    on: el.classList.contains('is-active'),
    el,
  }))
  hasGrid.value = !!head.querySelector('.gtools')
}
function show() {
  collect()
  open.value = true
}
function press(r: Row) {
  open.value = false
  r.el.click()
}
// A phone held upright sets its own size (PostGrid), like GridTools.
const size = computed({
  get: () => (phone.value ? settings.s.thumbSizePhone : settings.s.thumbSize),
  set: (v: number) => (phone.value ? (settings.s.thumbSizePhone = v) : (settings.s.thumbSize = v)),
})
const layouts: { value: Layout; label: string; icon: string }[] = [
  { value: 'justified', label: 'Rows', icon: 'rows' },
  { value: 'masonry', label: 'Columns', icon: 'columns' },
  { value: 'grid', label: 'Squares', icon: 'grid' },
]
</script>

<template>
  <span ref="root" class="page-more">
    <button v-if="phone" class="rv-icon-btn" type="button" title="More actions" aria-label="More actions" aria-haspopup="dialog" :aria-expanded="open" @click="show"><Icon name="more" /></button>
    <Sheet :open="open" :title="props.title ?? 'Actions'" @close="open = false">
      <button v-for="(r, i) in rows" :key="i" class="sheet-row" :class="{ 'is-on': r.on }" type="button" :disabled="r.disabled" @click="press(r)">
        <!-- (The button's own icon, copied from this page's markup.) -->
        <span class="ico" aria-hidden="true" v-html="r.icon"></span>
        <span class="grow"><span>{{ r.label }}</span></span>
        <Icon v-if="r.on" name="check" :size="16" />
      </button>
      <template v-if="hasGrid">
        <div v-if="rows.length" class="sheet-sep"></div>
        <div class="sheet-label rv-label">Layout</div>
        <div class="layouts" role="radiogroup" aria-label="Layout">
          <button v-for="l in layouts" :key="l.value" class="lay" :class="{ 'is-on': settings.s.layout === l.value }" type="button" role="radio" :aria-checked="settings.s.layout === l.value" @click="settings.s.layout = l.value">
            <Icon :name="l.icon" :size="18" /><span>{{ l.label }}</span>
          </button>
        </div>
        <label class="size">
          <span class="rv-label">Size</span>
          <input v-model.number="size" class="rv-slider" type="range" :min="phone ? 90 : 120" :max="phone ? 360 : 420" step="10" aria-label="Thumbnail size" />
          <span class="tabular">{{ size }}</span>
        </label>
      </template>
    </Sheet>
  </span>
</template>

<style scoped>
.page-more {
  display: contents;
}
.ico {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  color: var(--text-2);
}
.ico :deep(svg) {
  width: 18px;
  height: 18px;
}
.is-on .ico {
  color: var(--text);
}
/* The three layouts: one framed row of equal choices, the one in use inverted (as a Segmented). */
.layouts {
  display: flex;
  margin: 4px 16px 0;
  border: 1px solid var(--line-2);
}
.lay {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
  border: 0;
  color: var(--text-2);
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.lay + .lay {
  border-left: 1px solid var(--line-2);
}
.lay.is-on {
  color: var(--bg);
  background: var(--text);
}
.size {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 52px;
  padding: 4px 16px;
}
.size .rv-slider {
  flex: 1;
}
.size .tabular {
  width: 3ch;
  color: var(--text-2);
  font-size: 0.6875rem;
}
</style>
