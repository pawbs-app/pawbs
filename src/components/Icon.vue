<script setup lang="ts">
/* Line icons on a 16px grid: 1.5 stroke, square caps, mitre joins, drawn in currentColor.
   Filled parts are marked with the "f:" prefix. */
import { computed } from 'vue'

const ICONS: Record<string, string[]> = {
  play: ['f:M4.5 2.5v11l9-5.5z'],
  pause: ['f:M4 2.5h3v11H4zM9 2.5h3v11H9z'],
  volume: ['M2.5 6h2.5l3.5-3v10L5 10H2.5z', 'M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.3 6.3 0 0 1 0 9'],
  muted: ['M2.5 6h2.5l3.5-3v10L5 10H2.5z', 'M10.5 6l4 4M14.5 6l-4 4'],
  fullscreen: ['M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4'],
  'exit-fullscreen': ['M5.5 1.5v4h-4M14.5 5.5h-4v-4M10.5 14.5v-4h4M1.5 10.5h4v4'],
  info: ['M1.5 1.5h13v13h-13z', 'M8 7v4.5M8 4.5v1'],
  settings: ['M1.5 4h13M1.5 8h13M1.5 12h13', 'f:M4 2.5h2v3H4zM9.5 6.5h2v3h-2zM5.5 10.5h2v3h-2z'],
  sliders: ['M1.5 4.5h7M11.5 4.5h3M1.5 11.5h3M7.5 11.5h7', 'M8.5 3h3v3h-3zM4.5 10h3v3h-3z'],
  chevron: ['M4 6l4 4 4-4'],
  'chevron-up': ['M4 10l4-4 4 4'],
  'chevron-left': ['M10 3.5L5.5 8l4.5 4.5'],
  'chevron-right': ['M6 3.5l4.5 4.5L6 12.5'],
  plus: ['M8 2.5v11M2.5 8h11'],
  minus: ['M2.5 8h11'],
  search: ['M7 2.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 1 1 0-9z', 'M10.5 10.5l4 4'],
  edit: ['M10.5 2.5l3 3-8 8h-3v-3z'],
  close: ['M3 3l10 10M13 3L3 13'],
  check: ['M2.5 8.5l3.5 3.5 7.5-8'],
  copy: ['M5.5 5.5h9v9h-9z', 'M10.5 3.5v-2h-9v9h2'],
  download: ['M8 1.5v8M4.5 6l3.5 3.5L11.5 6M1.5 11v3.5h13V11'],
  retry: ['M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3.5H10'],
  bookmark: ['M3.5 1.5h9v13L8 11l-4.5 3.5z'],
  'bookmark-on': ['f:M3.5 1.5h9v13L8 11l-4.5 3.5z'],
  external: ['M9.5 1.5h5v5M14.5 1.5l-6.5 6.5M12.5 9.5v5h-11v-11h5'],
  link: ['M6.5 9.5l3-3', 'M7 4.5l1.5-1.5a2.8 2.8 0 0 1 4 4L11 8.5M9 11.5L7.5 13a2.8 2.8 0 0 1-4-4L5 7.5'],
  grid: ['M1.5 1.5h5v5h-5zM9.5 1.5h5v5h-5zM1.5 9.5h5v5h-5zM9.5 9.5h5v5h-5z'],
  rows: ['M1.5 2.5h13v4h-13zM1.5 9.5h6v4h-6zM10.5 9.5h4v4h-4z'],
  columns: ['M1.5 1.5h3.5v8h-3.5zM6.25 1.5h3.5v5h-3.5zM11 1.5h3.5v10H11zM1.5 11.5h3.5v3h-3.5zM6.25 8.5h3.5v6h-3.5z'],
  home: ['M1.5 7.5L8 2l6.5 5.5', 'M3.5 6v8.5h9V6'],
  trend: ['M1.5 12.5l4.5-4.5 3 3 5.5-5.5', 'M10 5.5h4.5V10'],
  stack: ['M4 1.5h8M2.5 4h11', 'M1.5 6.5h13v8h-13z'],
  eye: ['M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z', 'M8 6a2 2 0 1 1 0 4a2 2 0 1 1 0-4z'],
  'eye-off': ['M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z', 'M2.5 13.5l11-11'],
  clock: ['M8 1.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13z', 'M8 4.5V8l2.5 2.5'],
  'arrow-up': ['M8 13.5v-11M3.5 7L8 2.5 12.5 7'],
  'arrow-down': ['M8 2.5v11M3.5 9L8 13.5 12.5 9'],
  'arrow-left': ['M14.5 8h-12M7 3.5L2.5 8 7 12.5'],
  loop: ['M2.5 7V4.5h10.5L11 2.5', 'M13.5 9v2.5H3l2 2'],
  trash: ['M2 4h12M6 4V2h4v2', 'M3.5 4l1 10.5h7l1-10.5'],
  menu: ['M1.5 4h13M1.5 8h13M1.5 12h13'],
  more: ['f:M2 7h2.5v2.5H2zM6.75 7h2.5v2.5h-2.5zM11.5 7H14v2.5h-2.5z'],
  shuffle: ['M1.5 4.5h3l7 7h3M1.5 11.5h3l7-7h3', 'M12.5 2.5l2 2-2 2M12.5 9.5l2 2-2 2'],
  comment: ['M1.5 2.5h13v9h-7l-3.5 3v-3h-2.5z'],
  user: ['M8 1.5a3 3 0 1 1 0 6a3 3 0 1 1 0-6z', 'M2.5 14.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5'],
  folder: ['M1.5 3h5l1.5 1.5h6.5v9.5h-13z'],
  list: ['M5 4h9.5M5 8h9.5M5 12h9.5', 'M1.5 4h1M1.5 8h1M1.5 12h1'],
  tag: ['M1.5 1.5h6l7 7-6 6-7-7z', 'f:M4 4h2v2H4z'],
  note: ['M2.5 1.5h11v13h-11z', 'M5 5h6M5 8h6M5 11h3.5'],
  width: ['M1.5 8h13', 'M4 5.5L1.5 8 4 10.5M12 5.5l2.5 2.5-2.5 2.5', 'M1.5 1.5v2M14.5 1.5v2M1.5 12.5v2M14.5 12.5v2'],
  zoom: ['M7 2.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 1 1 0-9z', 'M10.5 10.5l4 4M7 5v4M5 7h4'],
  fit: ['M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4', 'M5 5h6v6H5z'],
  pool: ['M2.5 1.5h8l3 3v10h-11z', 'M5 7h6M5 10h6'],
  back10: ['M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2v3.5H6'],
  fwd10: ['M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3.5H10'],
  install: ['M8 1.5v8M4.5 6l3.5 3.5L11.5 6', 'M2.5 12.5h11'],
  speed: ['M2 11.5a6 6 0 1 1 12 0', 'M8 11.5l3-4'],
  random: ['M1.5 1.5h13v13h-13z', 'f:M4 4h2v2H4zM10 10h2v2h-2zM7 7h2v2H7z'],
  filter: ['M1.5 2.5h13l-5 6v5l-3 1.5v-6.5z'],
  key: ['M5.5 7a3 3 0 1 1 0 6a3 3 0 1 1 0-6z', 'M7.5 8l6-6M11 4.5l2 2'],
  sets: ['M1.5 5.5h10v9h-10z', 'M4 3h10.5v9'],
  similar: ['M1.5 1.5h8v8h-8z', 'M6.5 6.5h8v8h-8z'],
  camera: ['M1.5 4.5h3l1.5-2h4l1.5 2h3v9h-13z', 'M8 6.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5z'],
  transfer: ['M1.5 5h11M9.5 2l3 3-3 3', 'M14.5 11h-11M6.5 8l-3 3 3 3'],
  collection: ['M1.5 6.5h13v8h-13z', 'M3 4h10M4.5 1.5h7', 'M6 9.5h4'],
  select: ['M2.5 2.5h11v11h-11z', 'M5 8l2 2 4-4'],
  calendar: ['M1.5 3.5h13v11h-13z', 'M1.5 7h13', 'M5 1.5v3M11 1.5v3'],
  slideshow: ['M1.5 2.5h13v9h-13z', 'f:M6.5 4.5v5l4-2.5z', 'M4.5 14h7'],
  warning: ['M8 1.5l6.5 12.5h-13z', 'M8 6v4M8 11.5v1'],
}

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 16 })
const paths = computed(() =>
  (ICONS[props.name] ?? ICONS.info).map((d) => (d.startsWith('f:') ? { d: d.slice(2), fill: true } : { d, fill: false })),
)
</script>

<template>
  <svg class="rv-icon" viewBox="0 0 16 16" :width="size" :height="size" :style="size !== 16 ? { width: size + 'px', height: size + 'px' } : undefined" aria-hidden="true">
    <path v-for="(p, i) in paths" :key="i" :d="p.d" :class="{ fill: p.fill }" />
  </svg>
</template>
