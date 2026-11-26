<script setup lang="ts">
/* Layout and size controls shown at the right of a grid page's header. */
import Segmented from './Segmented.vue'
import { computed } from 'vue'
import { useSettings, type Layout } from '@/stores/settings'
import { phone } from '@/composables/phone'
import { useLayout } from '@/composables/layout'
const settings = useSettings()
const layout = useLayout()
// A phone held upright sets its own size, over a range that suits its width (PostGrid).
const size = computed({
  get: () => (phone.value ? settings.s.thumbSizePhone : settings.s.thumbSize),
  set: (v: number) => (phone.value ? (settings.s.thumbSizePhone = v) : (settings.s.thumbSize = v)),
})
const layouts: { value: Layout; label: string; icon: string; title: string }[] = [
  { value: 'justified', label: 'Rows', icon: 'rows', title: 'Rows: every picture keeps its shape' },
  { value: 'masonry', label: 'Columns', icon: 'columns', title: 'Columns: stacked by height' },
  { value: 'grid', label: 'Grid', icon: 'grid', title: 'Grid: equal squares' },
]
</script>

<template>
  <div class="gtools">
    <Segmented v-model="layout" :options="layouts" label="Layout" />
    <label class="size" title="Thumbnail size">
      <input v-model.number="size" class="rv-slider" type="range" :min="phone ? 90 : 120" :max="phone ? 360 : 420" step="10" aria-label="Thumbnail size" />
      <span class="tabular">{{ size }}</span>
    </label>
  </div>
</template>

<style scoped>
.gtools {
  display: flex;
  align-items: center;
  gap: 10px;
}
.size {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.6875rem;
  color: var(--text-2);
}
.size .rv-slider {
  width: 90px;
}
.size span {
  width: 26px;
}
@media (max-width: 640px) {
  .size .rv-slider {
    width: 72px;
  }
  .size span {
    display: none;
  }
}
</style>
