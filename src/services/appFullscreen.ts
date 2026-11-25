/* Full screen for the whole app (Settings › Browsing). For browsers that paint the system's bar in a
   colour of their own over the installed app, whatever the page asks for (a grey strip above a black
   page, on Android tablets): in full screen there is no bar.

   Three things are the browser's, not the app's:
   - it only goes into full screen on a press or a key, so the app enters at the first one after each
     start, and again at the next one after full screen was left;
   - Esc leaves full screen and does nothing else: the page does not even see the key. Where the
     browser can leave a key to the page (keyboard lock: Chromium, Android tablets included), Esc is
     kept for the app while it is in full screen: it closes the gallery or a dialog as always, and
     full screen stays;
   - Android's Back leaves full screen too, and that cannot be kept. So when full screen ends with
     the app in front and without it having asked, the app does what the press was for: the key
     layers get an Escape (it closes the gallery, a dialog, a menu), and where nothing took it, a
     touch device goes back a page, as its Back would have.

   The browser also drops full screen by itself when the app leaves the front (the home screen,
   another app): nobody pressed anything then, and nothing is made up for (taken for a Back, coming
   back to the app went back a page). Full screen returns at the next press.

   The choice stays with the device (localStorage), not with the app's data: a tablet's must not reach
   a phone through a backup or a transfer. */
import { ref, watch } from 'vue'
import { escapeFromOutside, isEscape } from './keyboard'

const KEY = 'nggallery.fullscreen'
/** The browser can put a page in full screen at all (an iPhone's cannot). */
export const canAppFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
/** The setting. */
export const appFullscreen = ref(canAppFullscreen && stored())

/** In full screen as a whole page, by this module (the gallery's own full screen is on its element). */
let inApp = false
/** Leaving was asked by the app (the setting turned off): nothing to make up for. */
let asked = false

/* Esc kept for the page while in full screen (see the header). Without it, Esc is the browser's. */
const keys = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { keyboard?: { lock?: (codes: string[]) => Promise<void>; unlock?: () => void } }).keyboard
let escKept = false
function keepEscape(on: boolean) {
  if (!keys?.lock) return
  if (!on) {
    escKept = false
    keys.unlock?.()
    return
  }
  keys.lock(['Escape']).then(
    () => (escKept = inApp),
    () => (escKept = false),
  )
}

/* Whether the app is in front, and since when: the browser drops full screen when it is not, and
   says so only once the app is back. */
let frontSince = -Infinity
function inFront(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus() && performance.now() - frontSince > 1500
}

function enter() {
  if (!appFullscreen.value || document.fullscreenElement) return
  // navigationUI: the system's navigation bar goes too.
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
    /* not allowed just now (no press behind this call): the next press asks again */
  })
}
function onPress(e: Event) {
  // (Esc right after it left full screen must not bring it back.)
  if (e instanceof KeyboardEvent && (isEscape(e) || e.ctrlKey || e.metaKey || e.altKey)) return
  enter()
}
function onChange() {
  const el = document.fullscreenElement
  if (el) {
    inApp = el === document.documentElement
    if (inApp) keepEscape(true)
    return
  }
  if (!inApp) return
  inApp = false
  const escWasKept = escKept
  keepEscape(false)
  if (asked) {
    asked = false
    return
  }
  // Dropped by the browser while the app was away: nobody pressed anything.
  if (!inFront()) return
  const touch = matchMedia('(hover: none), (pointer: coarse)').matches
  // Esc was the app's all along: on a computer, this is Esc held down to leave full screen on purpose.
  if (escWasKept && !touch) return
  // Left with Back (or with an Esc the browser kept for itself): see the header.
  if (escapeFromOutside()) return
  if (touch && (history.state as { back?: unknown } | null)?.back != null) history.back()
}

/** Start following the setting. Called once, when the app starts. */
export function startAppFullscreen() {
  if (!canAppFullscreen) return
  document.addEventListener('fullscreenchange', onChange)
  const front = () => (frontSince = performance.now())
  document.addEventListener('visibilitychange', front)
  window.addEventListener('focus', front)
  window.addEventListener('pointerup', onPress, true)
  window.addEventListener('keydown', onPress, true)
  watch(appFullscreen, (on) => {
    try {
      if (on) localStorage.setItem(KEY, '1')
      else localStorage.removeItem(KEY)
    } catch {
      /* no storage: for this visit only */
    }
    if (on) enter() // (turned on by a press: allowed at once)
    else if (inApp) {
      asked = true
      document.exitFullscreen().catch(() => (asked = false))
    }
  })
}
