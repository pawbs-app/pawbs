<script setup lang="ts">
import Dialog from './Dialog.vue'
import { useSettings } from '@/stores/settings'
import { DOWNLOADS } from '@/features'
import { vaultOn } from '@/services/lock'
const emit = defineEmits<{ close: [] }>()
const settings = useSettings()
const groups = [
  {
    name: 'Anywhere',
    keys: [
      ['/', 'Search'],
      ['Q', 'Query assistant'],
      ['?', 'This list'],
      ...(vaultOn.value ? [['H', 'Lock pawbs']] : []),
      ['Esc', 'Close what is open'],
      ['Right-click', 'Shortcuts for what is under the pointer (Shift: the browser’s menu)'],
    ],
  },
  {
    name: 'Grid',
    keys: [
      ['← → ↑ ↓', 'Move between posts'],
      ['Enter', 'Open the post'],
      ['Ctrl + click', 'Select posts (then a click adds or removes one)'],
      ['Shift + click', 'Select every post up to this one'],
      ['Space', 'While selecting: select the focused post'],
      ['Ctrl + A', 'While selecting: select every post shown'],
      ['Esc', 'Clear the selection'],
      ['Middle click', 'Open in a new tab'],
    ],
  },
  {
    name: 'Gallery',
    keys: [
      ['← →', 'Previous / next post'],
      ['Home End', 'First / last loaded post'],
      ['Numpad 0', `Video: back ${settings.s.seekStep} s (Shift: ×6)`],
      ['Numpad .', `Video: forward ${settings.s.seekStep} s (Shift: ×6)`],
      [', .', 'Video, paused: one frame back / forward'],
      ['Space', 'Video: play / pause (slideshow: pause)'],
      ['P', 'Slideshow on / off'],
      ['M  L', 'Video: mute / loop'],
      ['A', 'Video: A-B loop: start, end, off'],
      ['S', 'Save to favourites'],
      ['K', 'Add to the collection last added to'],
      ['Shift + K', 'Add to a collection…'],
      ['X', 'Not interested: hide it, on to the next'],
      ...(DOWNLOADS ? [['D', 'Download']] : []),
      ['O  C', 'Open original / copy link'],
      ['Z', 'Zoom: fit → width → actual size'],
      ['+  −', 'Zoom in / out (back to fit: double-click)'],
      ['Double-click', 'This picture at actual size, and back'],
      ['Wheel', 'Nothing, next / previous or zoom (Settings › Gallery)'],
      ['I', 'Details panel'],
      ['N', 'Notes on / off'],
      ['F', 'Full screen'],
      ['Esc', 'Back to the grid'],
    ],
  },
]
</script>

<template>
  <Dialog title="Keyboard shortcuts" wide @close="emit('close')">
    <div class="cols">
      <section v-for="g in groups" :key="g.name">
        <h3 class="rv-heading rv-label">{{ g.name }}</h3>
        <dl class="rv-dl">
          <template v-for="[k, v] in g.keys" :key="k">
            <dt><kbd>{{ k }}</kbd></dt>
            <dd>{{ v }}</dd>
          </template>
        </dl>
      </section>
    </div>
    <p class="rv-hint">Touch: swipe left or right to step, down to close, up for the details; tap to show or hide the controls; pinch or double-tap to zoom (on a video, double-tap the sides to seek).</p>
  </Dialog>
</template>

<style scoped>
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.cols section:last-child {
  grid-row: span 2;
}
.cols .rv-heading {
  margin-bottom: 8px;
}
.rv-dl {
  grid-template-columns: max(110px, 9.2em) 1fr;
}
kbd {
  font: inherit;
  color: var(--text);
  white-space: nowrap;
}
@media (max-width: 640px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
</style>
