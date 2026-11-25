/* Open-out: a bracketed box handing over to a new page (Set up's box once answered, the age
   question before a page). Its content fades, and its corner brackets open out to the corners of
   the screen, growing a little, then fade there while the new page comes in underneath, like the
   frame widening to become the page. The brackets travel on a frame of their own, fixed over
   everything, so the page can change under them; the box's own give way to it at once (same
   place, same look). */

/** Resolves when the frame has reached the screen's corners (the caller changes the page then);
    the frame fades out after on its own. At once with the interface effects off or reduced motion. */
export function openOut(box: HTMLElement | null | undefined): Promise<void> {
  const root = document.documentElement
  if (!box || root.dataset.fx === 'off' || !matchMedia('(prefers-reduced-motion: no-preference)').matches) return Promise.resolve()
  const speed = parseFloat(getComputedStyle(root).getPropertyValue('--fx-speed')) || 1
  const r = box.getBoundingClientRect()
  const cs = getComputedStyle(box)
  const frame = document.createElement('div')
  frame.className = 'rv-brackets'
  frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, zIndex: '500', pointerEvents: 'none' })
  const bs = cs.getPropertyValue('--bs').trim() || '12px'
  frame.style.setProperty('--bc', cs.getPropertyValue('--bc').trim() || 'currentColor')
  frame.style.setProperty('--bs', bs)
  document.body.appendChild(frame)
  box.style.background = 'none'
  box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150 * speed, easing: 'ease-in', fill: 'forwards' })

  const m = 14 // the frame's last place: this far in from the screen's edges
  const grow = frame.animate(
    [
      { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, '--bs': bs },
      { left: `${m}px`, top: `${m}px`, width: `${window.innerWidth - 2 * m}px`, height: `${window.innerHeight - 2 * m}px`, '--bs': '26px' },
    ],
    { duration: 420 * speed, delay: 60 * speed, easing: 'cubic-bezier(0.7, 0, 0.2, 1)', fill: 'forwards' },
  )
  const fade = frame.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240 * speed, delay: 470 * speed, easing: 'ease-out', fill: 'forwards' })
  // (A tab in the background draws no frames: the timers settle it, and the frame goes regardless.)
  const gone = window.setTimeout(() => frame.remove(), 900 * speed)
  void fade.finished.then(() => {
    window.clearTimeout(gone)
    frame.remove()
  }, () => frame.remove())
  return new Promise((resolve) => {
    const t = window.setTimeout(resolve, 600 * speed)
    void grow.finished.then(() => {
      window.clearTimeout(t)
      resolve()
    }, resolve)
  })
}
