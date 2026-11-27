/* The entry of a disguise's page (as.html, served at /as/<kind>/): only its decoy (src/decoys/<kind>,
   a small chunk of its own, loaded for this kind alone), and pawbs (src/main.ts) only once the code
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
  await import('./main')
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
