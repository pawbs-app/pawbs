/* The zoom into a picture (styles/fx.css: ::view-transition-*(rv-zoom)): a view transition, the
   browser's own morph between two states of the page, takes a thumbnail to the viewer's picture when
   a post opens and back when it closes, cross-fading inside a tracking frame. Only on a big enough
   screen (see bigScreen), with the interface effects on, without reduced motion, where the browser
   has view transitions, and when both ends are on screen; otherwise the change just happens.
   While a transition runs the page takes no input (half a second). */

const NAME = 'rv-zoom'

type ViewTransition = { finished: Promise<void> }
type WithTransitions = Document & { startViewTransition?: (update: () => Promise<void>) => ViewTransition }

export function effectsOn(): boolean {
  return document.documentElement.dataset.fx !== 'off' && !matchMedia('(prefers-reduced-motion: reduce)').matches
}

function onScreen(el: Element | null | undefined): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  const r = el.getBoundingClientRect()
  return r.width > 4 && r.height > 4 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
}

async function waitFor(find: () => Element | null | undefined, ms: number): Promise<HTMLElement | null> {
  const t0 = performance.now()
  for (;;) {
    const el = find()
    if (onScreen(el)) return el
    if (performance.now() - t0 > ms) return null
    // Timers, not animation frames: the browser holds its rendering (frames included) while a
    // view transition waits for the page to change.
    await new Promise((r) => setTimeout(r, 16))
  }
}

let running = false

/* Only on a screen big enough for it: wider than the phone's layout and taller than a phone turned
   sideways (tablets, computers). On a phone the picture just appears, its frame still locking on:
   there the zoom fought the phone's bars coming and going as the picture opened (full screen
   returning with the press, the browser's toolbar), and Firefox showed it doubled and jumpy. */
const bigScreen = () => matchMedia('(min-width: 641px) and (min-height: 501px)').matches

/** Runs `change` (which updates the page), morphing `from` into what `to` finds afterwards (waiting
    up to `wait` ms for it to be laid out; the page is frozen meanwhile). */
export async function morph(from: Element | null | undefined, change: () => unknown, to: () => Element | null | undefined, wait = 500): Promise<void> {
  const doc = document as WithTransitions
  if (running || !bigScreen() || !effectsOn() || !doc.startViewTransition || !onScreen(from)) {
    await change()
    return
  }
  running = true
  // No gestures meanwhile (styles/fx.css): a pinch would zoom the page instead of the picture.
  document.documentElement.classList.add('is-morphing')
  from.style.viewTransitionName = NAME
  let target: HTMLElement | null = null
  try {
    const t = doc.startViewTransition(async () => {
      from.style.viewTransitionName = ''
      await change()
      target = await waitFor(to, wait)
      if (target) target.style.viewTransitionName = NAME
    })
    await t.finished
  } catch {
    /* a transition the browser skipped: the change itself has run */
  } finally {
    from.style.viewTransitionName = ''
    if (target) (target as HTMLElement).style.viewTransitionName = ''
    document.documentElement.classList.remove('is-morphing')
    running = false
  }
}

/** A post's thumbnail picture in the grid behind (if it is drawn). */
export const thumbPicture = (id: number) => document.querySelector(`.thumb[data-id="${id}"] img`)
/** The viewer's picture (or video) on screen. */
export const viewerPicture = () => document.querySelector('.viewer .media.cur')
