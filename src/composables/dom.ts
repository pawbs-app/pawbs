import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/** Call fn on a pointer down outside the given elements while active. */
export function useClickOutside(targets: Ref<HTMLElement | null>[], fn: () => void, active: Ref<boolean>) {
  const handler = (e: PointerEvent) => {
    if (!active.value) return
    const t = e.target as Node
    if (targets.some((r) => r.value?.contains(t))) return
    fn()
  }
  onMounted(() => document.addEventListener('pointerdown', handler, true))
  onBeforeUnmount(() => document.removeEventListener('pointerdown', handler, true))
}

/** Width of an element, kept current. */
export function useWidth(el: Ref<HTMLElement | null>) {
  const width = ref(0)
  let ro: ResizeObserver | null = null
  onMounted(() => {
    ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width)
      // A kept-alive page is detached while hidden and reports 0: keep the last layout for its return.
      if (w > 0 && w !== width.value) width.value = w
    })
    if (el.value) {
      width.value = Math.floor(el.value.getBoundingClientRect().width)
      ro.observe(el.value)
    }
  })
  watch(el, (n, o) => {
    if (o) ro?.unobserve(o)
    if (n) ro?.observe(n)
  })
  onBeforeUnmount(() => ro?.disconnect())
  return width
}

/** True after `delay` ms without pointer movement; any movement resets it. */
export function useIdle(delay: Ref<number>, target: Ref<HTMLElement | null>) {
  const idle = ref(false)
  let timer: number | null = null
  const poke = () => {
    if (idle.value) idle.value = false
    if (timer != null) clearTimeout(timer)
    timer = window.setTimeout(() => (idle.value = true), delay.value)
  }
  onMounted(() => {
    const el = target.value ?? window
    el.addEventListener('pointermove', poke as EventListener, { passive: true })
    el.addEventListener('pointerdown', poke as EventListener, { passive: true })
    el.addEventListener('wheel', poke as EventListener, { passive: true })
    // The keyboard too: focus moving onto a control (Tab) must not land on one that has faded away.
    el.addEventListener('focusin', poke as EventListener)
    poke()
  })
  onBeforeUnmount(() => {
    const el = target.value ?? window
    el.removeEventListener('pointermove', poke as EventListener)
    el.removeEventListener('pointerdown', poke as EventListener)
    el.removeEventListener('wheel', poke as EventListener)
    el.removeEventListener('focusin', poke as EventListener)
    if (timer != null) clearTimeout(timer)
  })
  return { idle, poke }
}

/** Run when the element scrolls into view (with a margin ahead, which may change). */
export function useNearViewport(el: Ref<HTMLElement | null>, fn: () => void, margin: string | (() => string) = '1200px') {
  let io: IntersectionObserver | null = null
  const visible = ref(false)
  const marginNow = () => (typeof margin === 'function' ? margin() : margin)
  function observe() {
    io?.disconnect()
    const m = marginNow()
    io = new IntersectionObserver(
      (entries) => {
        visible.value = entries.some((e) => e.isIntersecting)
        if (visible.value) fn()
      },
      { rootMargin: `${m} 0px ${m} 0px` },
    )
    if (el.value) io.observe(el.value)
  }
  onMounted(observe)
  // A new margin: observe again (the first report says at once whether the element is now in reach).
  if (typeof margin === 'function') watch(margin, () => io && observe())
  watch(el, (n, o) => {
    if (o) io?.unobserve(o)
    if (n) io?.observe(n)
  })
  onBeforeUnmount(() => io?.disconnect())
  return visible
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
