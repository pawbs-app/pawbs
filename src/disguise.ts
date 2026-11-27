/* The entry of a disguise's page (as.html, served at /as/<kind>/): only its decoy (src/decoys/<kind>,
   a small chunk of its own, loaded for this kind alone), and pawbs only once the code
   set with the disguise is given. Back in the background for half a minute, it opens on the decoy
   again. Arriving from Settings › Privacy › Disguise, it offers to install itself. */
import { DEFAULT_COLOR, disguise, isSecret, KIND_INFO, normalizeSecret, type DisguiseKind } from './services/disguise'

export interface DecoyContext {
  name: string
  /** The icon colour, "#rrggbb". */
  color: string
  /** Opens pawbs when `typed` is the code (resolves false otherwise: the decoy carries on as it is). */
  unlock: (typed: string) => Promise<boolean>
}
export type Decoy = { mount: (root: HTMLElement, ctx: DecoyContext) => void }

// The browser's install offer can come at once: kept for the bar below.
let offer: (Event & { prompt: () => Promise<void> }) | null = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  offer = e as Event & { prompt: () => Promise<void> }
  showInstall()
})

const d = disguise
if (!d) location.replace('/')
else void start(d.kind, d.name)

async function start(kind: DisguiseKind, name: string) {
  const color = `#${/^[0-9a-f]{6}$/.test(new URLSearchParams(location.search).get('color') ?? '') ? new URLSearchParams(location.search).get('color') : DEFAULT_COLOR[kind]}`
  const root = document.getElementById('decoy')!
  const decoys: Record<DisguiseKind, () => Promise<Decoy>> = {
    calculator: () => import('./decoys/calculator'),
    notes: () => import('./decoys/notes'),
    timer: () => import('./decoys/timer'),
  }
  const decoy = await decoys[kind]()
  decoy.mount(root, {
    name,
    color,
    unlock: async (typed) => {
      if (!(await isSecret(normalizeSecret(typed, KIND_INFO[kind].secret)))) return false
      void open()
      return true
    },
  })
  showInstall()
}

let opened = false
async function open() {
  if (opened) return
  opened = true
  document.getElementById('decoy')?.remove()
  document.querySelector('.dk-install')?.remove()
  document.getElementById('app')!.hidden = false
  // Half a minute in the background: the decoy again (the page starts over).
  let hiddenAt = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now()
    else if (hiddenAt && Date.now() - hiddenAt > 30_000) location.reload()
  })
  try {
    await loadApp()
  } catch {
    location.reload()
  }
}

/* pawbs itself, as its own page names it: index.html (the service worker's copy offline) lists its
   current entry, preloads and stylesheet. Nothing of pawbs is part of this page's build, which keeps
   the decoy light and pawbs's build what it is without disguises. */
async function loadApp() {
  if (import.meta.env.DEV) {
    const entry = '/src/main.ts'
    await import(/* @vite-ignore */ entry)
    return
  }
  const res = await fetch('/index.html')
  if (!res.ok) throw new Error(`index.html: ${res.status}`)
  const page = await res.text()
  const abs = (u: string) => new URL(u, `${location.origin}/`).href
  const link = (rel: string, href: string) => {
    const l = document.createElement('link')
    l.rel = rel
    l.href = href
    l.crossOrigin = ''
    document.head.append(l)
    return l
  }
  for (const m of page.matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)) link('modulepreload', abs(m[1]))
  const css = /<link rel="stylesheet"[^>]*href="([^"]+)"/.exec(page)?.[1]
  if (css) {
    const l = link('stylesheet', abs(css))
    // (Styled before it shows; a stylesheet that never answers holds it 3 seconds at most.)
    await new Promise<void>((done) => {
      l.onload = l.onerror = () => done()
      setTimeout(done, 3000)
    })
  }
  const scripts = [...page.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map((m) => abs(m[1]))
  if (!scripts.length) throw new Error('index.html names no script')
  for (const s of scripts) await import(/* @vite-ignore */ s)
}

/* "Install <name>", once, when this page was opened from Settings › Privacy › Disguise and the browser
   offers to install it (Chrome, Edge); elsewhere, how to add it by hand. */
const OFFER = 'ngg:disguise-install'
function showInstall() {
  let asked = false
  try {
    asked = sessionStorage.getItem(OFFER) === '1'
  } catch {
    /* no storage: no bar */
  }
  if (!asked || opened || document.querySelector('.dk-install') || !document.getElementById('decoy')?.childElementCount) return
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!offer && !ios) return
  const bar = document.createElement('div')
  bar.className = 'dk-install'
  bar.style.cssText =
    'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:10;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:#2c2c2a;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.25)'
  const text = document.createElement('span')
  text.style.flex = '1'
  text.textContent = offer ? `Install ${document.title} on this device` : 'Tap Share, then Add to Home Screen'
  const close = () => {
    bar.remove()
    try {
      sessionStorage.removeItem(OFFER)
    } catch {
      /* gone with the tab anyway */
    }
  }
  const btn = (label: string, primary: boolean, run: () => void) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.style.cssText = `border:0;border-radius:10px;padding:8px 12px;font:inherit;cursor:pointer;${primary ? 'background:#fff;color:#2c2c2a' : 'background:transparent;color:#fff'}`
    b.onclick = run
    return b
  }
  bar.append(text)
  if (offer) {
    const o = offer
    bar.append(
      btn('Install', true, () => {
        close()
        void o.prompt().catch(() => {})
      }),
    )
  }
  bar.append(btn(offer ? 'Not now' : 'OK', false, close))
  document.body.append(bar)
}
