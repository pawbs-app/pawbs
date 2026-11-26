<script setup lang="ts">
/* The paw print of a passkey: the pawbs paw (components/PawMark, the same shapes on its 512 grid)
   with a fingerprint whorl in each pad. `reading`: framed by the app icon's brackets, with a line
   sweeping over it while the browser asks for the passkey (still with reduced motion). Decorative. */
defineProps<{ reading?: boolean }>()

const PAD = 'M256 248c-30 0-52 22-70 46c-16 22-30 36-30 56c0 22 18 34 40 34c22 0 38-10 60-10s38 10 60 10c22 0 40-12 40-34c0-20-14-34-30-56c-18-24-40-46-70-46z'
const TOES: [number, number, number, number, number][] = [
  [218, 176, 28, 38, 0],
  [294, 176, 28, 38, 0],
  [160, 236, 25, 33, -24],
  [352, 236, 25, 33, 24],
]
// The ridges' breaks: always the same pattern (a fixed seed), so the print never changes.
let seed = 7
const rnd = () => {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}
const dash = () => {
  const a: number[] = []
  for (let i = 0; i < 4; i++) a.push(Math.round(30 + rnd() * 90), Math.round(5 + rnd() * 7))
  return a.join(' ')
}
interface Ridge {
  cx: number
  cy: number
  rx: number
  ry: number
  rot: number
  dash: string
}
const toes = TOES.map(([x, y, rx, ry, r]) => ({
  x,
  y,
  rx,
  ry,
  r,
  ridges: Array.from({ length: 5 }, (_, k): Ridge => ({ cx: x, cy: y - k * 2.5, rx: rx * (1 - k * 0.2) - 3, ry: ry * (1 - k * 0.2) - 3, rot: r, dash: dash() })),
}))
const pad = Array.from({ length: 8 }, (_, k): Ridge => ({ cx: 256, cy: 326 - k * 3, rx: 112 - k * 14, ry: (112 - k * 14) * 0.72, rot: 0, dash: dash() }))
const uid = `pp${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <svg class="paw-print" :class="{ 'is-reading': reading }" viewBox="96 96 320 320" aria-hidden="true" focusable="false">
    <path class="frame" d="M104 104V150M104 104H150M408 104H362M408 104V150M104 408V362M104 408H150M408 408H362M408 408V362" fill="none" stroke-width="10" stroke-linecap="square" />
    <defs>
      <clipPath :id="`${uid}-pad`"><path :d="PAD" /></clipPath>
      <clipPath v-for="(t, i) in toes" :id="`${uid}-t${i}`" :key="i"><ellipse :cx="t.x" :cy="t.y" :rx="t.rx" :ry="t.ry" :transform="`rotate(${t.r} ${t.x} ${t.y})`" /></clipPath>
      <clipPath :id="`${uid}-top`"><rect class="sweep-area" x="96" y="96" width="320" height="320" /></clipPath>
    </defs>
    <g v-for="layer in reading ? ['base', 'lit'] : ['base']" :key="layer" :class="layer" :clip-path="layer === 'lit' ? `url(#${uid}-top)` : undefined" fill="none" stroke-width="4.5">
      <g v-for="(t, i) in toes" :key="i" :clip-path="`url(#${uid}-t${i})`">
        <ellipse v-for="(r, k) in t.ridges" :key="k" :cx="r.cx" :cy="r.cy" :rx="r.rx" :ry="r.ry" :transform="`rotate(${r.rot} ${r.cx} ${r.cy})`" :stroke-dasharray="r.dash" />
      </g>
      <g :clip-path="`url(#${uid}-pad)`">
        <ellipse v-for="(r, k) in pad" :key="k" :cx="r.cx" :cy="r.cy" :rx="r.rx" :ry="r.ry" :stroke-dasharray="r.dash" />
      </g>
    </g>
    <line v-if="reading" class="scan" x1="112" x2="400" y1="0" y2="0" stroke-width="5" />
  </svg>
</template>

<style scoped>
.paw-print {
  display: block;
  width: 1em;
  height: 1em;
  overflow: visible;
}
.base {
  stroke: currentColor;
}
.frame {
  stroke: var(--line-3);
  opacity: 0;
}
.is-reading .frame {
  opacity: 1;
}
.is-reading .base {
  opacity: 0.45;
}
.lit,
.scan {
  stroke: var(--warn);
}
/* The line sweeps down and back; the lit part of the print follows it. */
.scan {
  animation: paw-scan 2.4s ease-in-out infinite;
}
.sweep-area {
  animation: paw-sweep 2.4s ease-in-out infinite;
}
@keyframes paw-scan {
  0%,
  100% {
    transform: translateY(150px);
  }
  50% {
    transform: translateY(372px);
  }
}
@keyframes paw-sweep {
  0%,
  100% {
    transform: translateY(-266px);
  }
  50% {
    transform: translateY(-44px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .scan,
  .sweep-area {
    animation: none;
  }
  .scan {
    transform: translateY(264px);
  }
  .sweep-area {
    transform: translateY(-152px);
  }
}
</style>
