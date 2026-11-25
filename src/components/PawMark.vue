<script setup lang="ts">
/* The pawbs mark: a paw (a main pad and four toes), alone or in the corner brackets of the app icon.
   The same shapes as scripts/paw.mjs (favicon, app icons, social preview, static pages), on its 512
   grid. The paw takes the text colour; the brackets are fainter. Decorative: name the link or heading.

   squeeze(): a cat closing its paw (the toes curl down over the pad, which squashes, then all opens
   again), called by the title bar's paw link; with `tap`, a click on the mark itself does it (Home,
   first-run screen). Motion only when effects are on and reduced motion is not asked for. Each toe is
   its own group, so the outer ones keep their tilt (on the ellipse) while the group moves. */
import { ref } from 'vue'

const props = defineProps<{ framed?: boolean; tap?: boolean }>()
const svg = ref<SVGSVGElement | null>(null)

function squeeze() {
  const el = svg.value
  if (!el) return
  el.classList.remove('is-closing')
  void el.getBoundingClientRect() // restart when clicked again mid-way
  el.classList.add('is-closing')
}
function onEnd(e: AnimationEvent) {
  if (e.animationName.startsWith('paw-pad')) svg.value?.classList.remove('is-closing')
}
function onClick() {
  if (props.tap) squeeze()
}
defineExpose({ squeeze })
</script>

<template>
  <svg ref="svg" class="paw-mark" :viewBox="framed ? '96 96 320 320' : '128 133 256 256'" aria-hidden="true" focusable="false" @click="onClick" @animationend="onEnd">
    <path
      v-if="framed"
      class="frame"
      d="M104 104V150M104 104H150M408 104H362M408 104V150M104 408V362M104 408H150M408 408H362M408 408V362"
      fill="none"
      stroke-width="14"
      stroke-linecap="square"
    />
    <g fill="currentColor">
      <path class="pad" d="M256 248c-30 0-52 22-70 46c-16 22-30 36-30 56c0 22 18 34 40 34c22 0 38-10 60-10s38 10 60 10c22 0 40-12 40-34c0-20-14-34-30-56c-18-24-40-46-70-46z" />
      <!-- Each toe moves toward the pad (--dx, --dy, in grid units) as the paw closes. -->
      <g class="toe" style="--dx: 12px; --dy: 54px"><ellipse cx="218" cy="176" rx="28" ry="38" /></g>
      <g class="toe" style="--dx: -12px; --dy: 54px"><ellipse cx="294" cy="176" rx="28" ry="38" /></g>
      <g class="toe" style="--dx: 34px; --dy: 30px"><ellipse cx="160" cy="236" rx="25" ry="33" transform="rotate(-24 160 236)" /></g>
      <g class="toe" style="--dx: -34px; --dy: 30px"><ellipse cx="352" cy="236" rx="25" ry="33" transform="rotate(24 352 236)" /></g>
    </g>
  </svg>
</template>

<style scoped>
.paw-mark {
  display: block;
  flex: none;
  width: 1em;
  height: 1em;
  overflow: visible;
}
.frame {
  stroke: var(--text-3);
}
.toe,
.pad {
  transform-box: fill-box;
  transform-origin: center;
}
.pad {
  transform-origin: 50% 75%;
}
@media (prefers-reduced-motion: no-preference) {
  :root:not([data-fx='off']) .is-closing .toe {
    animation: paw-toe calc(0.48s * var(--fx-speed, 1)) cubic-bezier(0.4, 0, 0.2, 1);
  }
  :root:not([data-fx='off']) .is-closing .pad {
    animation: paw-pad calc(0.48s * var(--fx-speed, 1)) cubic-bezier(0.4, 0, 0.2, 1);
  }
}
/* Closed for a beat in the middle: the toes tucked in and flattened, the pad pressed wide. */
@keyframes paw-toe {
  40%,
  58% {
    transform: translate(var(--dx), var(--dy)) scale(0.8, 0.56);
  }
}
@keyframes paw-pad {
  40%,
  58% {
    transform: scale(1.08, 0.88);
  }
}
</style>
