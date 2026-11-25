/* v-decode="text": the element's text resolves from scrambled glyphs, left to right, when it first
   shows and whenever it changes, like a readout settling (styles/fx.css: interface effects).
   Instant when the effects are off or the system asks for reduced motion. The text is the
   directive's alone: the element holds nothing else. Spaces and slashes stay put, so "// " and the
   word gaps keep their place; a monospace face keeps the width still. */
import type { Directive } from 'vue'

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>+=#*'
const runs = new WeakMap<HTMLElement, number>()

function animated(): boolean {
  return document.documentElement.dataset.fx !== 'off' && !matchMedia('(prefers-reduced-motion: reduce)').matches
}

function stop(el: HTMLElement) {
  const raf = runs.get(el)
  if (raf != null) cancelAnimationFrame(raf)
  runs.delete(el)
}

function decode(el: HTMLElement, text: string) {
  stop(el)
  if (!text || !animated()) {
    el.textContent = text
    el.removeAttribute('aria-label')
    return
  }
  // Read whole by assistive technology while the letters settle.
  el.setAttribute('aria-label', text)
  const ms = Math.min(460, 180 + text.length * 14)
  const t0 = performance.now()
  let lastShuffle = 0
  const frame = (now: number) => {
    const p = Math.min(1, (now - t0) / ms)
    if (p < 1 && now - lastShuffle < 40) {
      runs.set(el, requestAnimationFrame(frame)) // a new glyph every 40 ms reads as flicker, not noise
      return
    }
    lastShuffle = now
    const settled = Math.floor(p * p * text.length) // eased: the start settles slowly, the end at once
    let out = text.slice(0, settled)
    for (let i = settled; i < text.length; i++) {
      const c = text[i]
      out += c === ' ' || c === '/' ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0]
    }
    el.textContent = out
    if (p < 1) runs.set(el, requestAnimationFrame(frame))
    else {
      el.textContent = text
      el.removeAttribute('aria-label')
      runs.delete(el)
    }
  }
  runs.set(el, requestAnimationFrame(frame))
}

export const vDecode: Directive<HTMLElement, string | null | undefined> = {
  mounted(el, { value }) {
    decode(el, value ?? '')
  },
  updated(el, { value, oldValue }) {
    if (value !== oldValue) decode(el, value ?? '')
  },
  beforeUnmount(el) {
    stop(el)
  },
}
