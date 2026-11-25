/* One keydown listener for the whole app. Layers (the viewer over the grid, a dialog over both)
   register handlers; the topmost layer that handles a key stops it. Typing in a field is left alone
   except for Escape.

   "Topmost" is by level, not by when a layer was added: a page that mounts after the viewer opened
   over it (a lazily loaded page under a link with ?post=, a kept-alive page coming back) must not
   take the viewer's keys. Within a level, the latest layer comes first. */
import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue'

/** true: the key is taken (nothing else gets it, the browser included). 'native': it is the
    browser's (a focused slider's arrows, a focused button's Space) and no layer underneath gets it. */
export type KeyHandler = (e: KeyboardEvent) => boolean | 'native' | void

/** What a layer belongs to, bottom to top. */
export const KeyLevel = { App: 0, Page: 1, Viewer: 2, Dialog: 3, Menu: 4 } as const
export type KeyLevel = (typeof KeyLevel)[keyof typeof KeyLevel]

interface Layer {
  id: number
  handler: KeyHandler
  /** Receive keys even while a text field has focus. */
  inFields: boolean
  level: KeyLevel
}

const layers: Layer[] = []
let seq = 0

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes(type)
  }
  return el.isContentEditable
}

/* Escape, however the keyboard and the system send it. Physical keyboards on Android tablets do not
   all say "Escape": some name it otherwise ("Esc", only its key code), some report a modifier with it,
   some send the Back key's names, and some deliver it only when the key is released. Layers see one
   plain Escape (key "Escape", no modifiers) for all of them. */
export function isEscape(e: KeyboardEvent): boolean {
  return e.key === 'Escape' || e.key === 'Esc' || e.code === 'Escape' || e.keyCode === 27 || e.key === 'GoBack' || e.key === 'BrowserBack'
}
const PLAIN = new Set<PropertyKey>(['ctrlKey', 'metaKey', 'altKey', 'shiftKey'])
function asEscape(e: KeyboardEvent): KeyboardEvent {
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return e
  return new Proxy(e, {
    get(t, p) {
      if (p === 'key') return 'Escape'
      if (PLAIN.has(p)) return false
      // The event's own getters and methods need the real event as `this`.
      const v = Reflect.get(t, p, t)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
}

/** Hands a key to the topmost layer that takes it; true when one did. */
function dispatch(e: KeyboardEvent): boolean {
  const typing = isTyping(e.target)
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]
    if (typing && !l.inFields && e.key !== 'Escape') continue
    const took = l.handler(e)
    if (took === true) return true
    if (took === 'native') return false
  }
  return false
}

let escPressedAt = -Infinity
/** An Escape (or Android's Back) the browser kept for itself to leave the app's full screen
    (services/appFullscreen): the page never saw it, so it is handed to the layers now; true when one
    took it. Its release, if one follows, is that same press and not a second Escape. */
export function escapeFromOutside(): boolean {
  escPressedAt = performance.now()
  return dispatch(new KeyboardEvent('keydown', { key: 'Escape' }))
}
function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  const esc = isEscape(e)
  if (esc) escPressedAt = performance.now()
  if (dispatch(esc ? asEscape(e) : e)) {
    e.preventDefault()
    e.stopPropagation()
  }
}
/* An Escape released with no press just before it (the keyboards that send only the release) counts
   as a press. Except the release of the press that took the page out of full screen: the browser kept
   that press for itself, and it must not also close what is open. Exactly that one release is skipped,
   whether it comes before the browser reports leaving full screen or just after, so a second Escape
   right away closes the gallery. (Skipping every release for a second made that second press fail.) */
let escUpInFullscreenAt = -Infinity
let leftFullscreenAt = -Infinity
let exitReleaseDue = false
/** The page itself was in full screen (Settings › Browsing, services/appFullscreen), not the gallery:
    there Esc is an ordinary key (kept for the page where the browser allows), and its release counts. */
let wholePage = false
function onFullscreenChange() {
  if (document.fullscreenElement) {
    wholePage = document.fullscreenElement === document.documentElement
    return
  }
  if (wholePage) {
    wholePage = false
    return
  }
  leftFullscreenAt = performance.now()
  // Its release came while the page was still in full screen: nothing left to skip.
  exitReleaseDue = leftFullscreenAt - escUpInFullscreenAt > 1000
}
function onKeyUp(e: KeyboardEvent) {
  if (e.defaultPrevented || !isEscape(e)) return
  const now = performance.now()
  if (document.fullscreenElement && document.fullscreenElement !== document.documentElement) {
    escUpInFullscreenAt = now
    return
  }
  const exitRelease = exitReleaseDue && now - leftFullscreenAt < 800
  exitReleaseDue = false
  if (exitRelease || now - escPressedAt < 1500) return
  if (dispatch(asEscape(e))) {
    e.preventDefault()
    e.stopPropagation()
  }
}

let installed = false
function install() {
  if (installed) return
  installed = true
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKeyUp)
  document.addEventListener('fullscreenchange', onFullscreenChange)
}

export function pushKeyLayer(handler: KeyHandler, inFields = false, level: KeyLevel = KeyLevel.Page): () => void {
  install()
  const layer = { id: seq++, handler, inFields, level }
  // Kept sorted by level (onKey walks from the end): above every layer of its level and below.
  let at = layers.length
  while (at > 0 && layers[at - 1].level > level) at--
  layers.splice(at, 0, layer)
  return () => {
    const i = layers.findIndex((l) => l.id === layer.id)
    if (i >= 0) layers.splice(i, 1)
  }
}

/** Register a key layer while a component is on screen (a kept-alive page drops it while hidden). */
export function useKeyLayer(handler: KeyHandler, inFields = false, level: KeyLevel = KeyLevel.Page) {
  let off: (() => void) | null = null
  const on = () => {
    off?.()
    off = pushKeyLayer(handler, inFields, level)
  }
  const drop = () => {
    off?.()
    off = null
  }
  onMounted(on)
  onActivated(() => {
    if (!off) on()
  })
  onDeactivated(drop)
  onBeforeUnmount(drop)
}
