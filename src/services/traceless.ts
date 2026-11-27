/* No trace in the browser's history (Settings › Privacy: on by default in the installed app, off in
   a browser tab unless chosen, each its own choice on a device): the address stays the
   same whatever page is open, the route living in each history entry's state instead
   (services/tracelessHistory); the tab's title stays "pawbs" (or a disguise's name); a reload stays
   on its page (the browser keeps an entry's state); a new tab gets its page through a one-time
   hand-over in storage rather than in its address. Read before anything else starts, as the router
   is made with it. A disguise (services/disguise) always works this way. */
import { disguise } from './disguise'

// (Not under "ngg:": pawbs's own storage takes those keys over at its start, stores/persist; these
// are read before it.)
const KEY = 'traceless' // in a browser tab: "1" when on (off unless chosen)
const APP_KEY = 'traceless-app' // in the installed app: "0" when off (on unless chosen)
const OPEN = 'tl-open:'

/** Running as the installed app, in a window of its own, rather than in a browser tab. */
export const installedWindow: boolean = (() => {
  try {
    return (
      ['standalone', 'window-controls-overlay', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches) ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
})()

function readFlag(): boolean {
  try {
    // A tab opened from a page without a trace (its hand-over, below) stays that way while it lives,
    // reloads included, whatever this browser's own setting.
    if (new URLSearchParams(location.search).has('tl-open')) sessionStorage.setItem(KEY, '1')
    if (sessionStorage.getItem(KEY) === '1') return true
    return installedWindow ? localStorage.getItem(APP_KEY) !== '0' : localStorage.getItem(KEY) === '1'
  } catch {
    return installedWindow
  }
}

export const traceless: boolean = !!disguise || readFlag()

/** Switched on or off (in the installed app or in the browser, each its own choice): the page
    reloads on the other kind of history, on the same page. */
export function setTraceless(on: boolean, fullPath: string): void {
  try {
    sessionStorage.removeItem(KEY)
    if (installedWindow) {
      if (on) localStorage.removeItem(APP_KEY)
      else localStorage.setItem(APP_KEY, '0')
    } else if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    return
  }
  // (Off: the page goes back into the address, as the hash history reads it from there.)
  if (!on) history.replaceState(null, '', `${location.pathname}${location.search}#${fullPath}`)
  location.reload()
}

/** The tab's title: as given, or the constant one. */
export function pageTitle(title: string): void {
  document.title = traceless ? (disguise?.name ?? 'pawbs') : title
}

/** The address this page keeps: its own, without the route (nor a hand-over's mark), its query
    otherwise as written (a disguise's is its installed app's start). */
export function constantUrl(): string {
  const s = location.search
    .slice(1)
    .split('&')
    .filter((p) => p && !p.startsWith('tl-open='))
    .join('&')
  return location.pathname + (s ? `?${s}` : '')
}

/** Where to start: a new tab's hand-over, the route in the address (a link, a bookmark), the
    entry's state (a reload), or Home. */
export function startRoute(): string {
  const id = new URLSearchParams(location.search).get('tl-open')
  if (id) {
    try {
      const to = localStorage.getItem(OPEN + id)
      localStorage.removeItem(OPEN + id)
      if (to) return to
    } catch {
      /* no storage: Home */
    }
  }
  const hash = location.hash.replace(/^#/, '')
  if (hash.startsWith('/')) return hash
  const st = history.state as { current?: unknown } | null
  return typeof st?.current === 'string' && st.current.startsWith('/') ? st.current : '/'
}

/** The page an address of this app leads to ("…#/posts?q=…"), or null for anything else. */
export function appRoute(href: string): string | null {
  try {
    const u = new URL(href, location.href)
    if (u.origin !== location.origin || !u.hash.startsWith('#/')) return null
    return u.pathname === location.pathname ? decodeURI(u.hash.slice(1)) : null
  } catch {
    return null
  }
}

/** A page of the app in a new tab, its route handed over through storage. */
export function openTraceless(fullPath: string): void {
  const id = `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}`
  try {
    // (Hand-overs never taken, a tab that did not open: cleared after a minute by the next one.)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(OPEN) && Date.now() - Number(k.slice(OPEN.length).split('-')[0]) > 60_000) localStorage.removeItem(k)
    }
    localStorage.setItem(`${OPEN}${id}`, fullPath)
  } catch {
    return void window.open(constantUrl(), '_blank', 'noopener')
  }
  const base = constantUrl()
  window.open(`${base}${base.includes('?') ? '&' : '?'}tl-open=${id}`, '_blank', 'noopener')
}
