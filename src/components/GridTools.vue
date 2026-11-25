<script setup lang="ts">
/* Layout and size controls shown at the right of a grid page's header. */
import Segmented from './Segmented.vue'
import { useSettings, type Layout } from '@/stores/settings'
const settings = useSettings()
const layouts: { value: Layout; label: string; icon: string; title: string }[] = [
  { value: 'justified', label: 'Rows', icon: 'rows', title: 'Rows: every picture keeps its shape' },
  { value: 'masonry', label: 'Columns', icon: 'columns', title: 'Columns: stacked by height' },
  { value: 'grid', label: 'Grid', icon: 'grid', title: 'Grid: equal squares' },
]
</script>

<template>
  <div class="gtools">
    <Segmented v-model="settings.s.layout" :options="layouts" label="Layout" />
    <label class="size" title="Thumbnail size">
      <input v-model.number="settings.s.thumbSize" class="rv-slider" type="range" min="120" max="420" step="10" aria-label="Thumbnail size" />
      <span class="tabular">{{ settings.s.thumbSize }}</span>
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
  .size {
    display: none;
  }
}
</style>
