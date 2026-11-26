/* Locking, with encryption on (services/vault, stores/persist).

   Locking saves what is pending and reloads the page: whatever was decrypted, in the stores, the
   views and the pictures shown, goes with the page, and the app starts again on its lock screen.
   Every tab of the app locks together, and a tab opened while another one is unlocked gets the keys
   from it instead of asking again (a post opened in a new tab).

   Auto-lock (Settings › Privacy): after a time without use, or after a time with the app in the
   background. Use counts across tabs, and so does being shown: a tab in the background does not lock
   while another one is in front. A playing video or a running slideshow counts as use.

   The cover: while the app is in the background (and the setting is on, or a lock may follow), its
   content is hidden under the lock pattern, so the system's app switcher preview shows nothing. On
   the way back the lock is decided before the content shows again. */
import { ref } from 'vue'
import { freezeStorage, isLocked, persistNow, vaultKeys, vaultMeta } from '@/stores/persist'
import type { VaultKeys } from './vault'

/** Encryption is on (and this tab unlocked): the lock button shows. */
export const vaultOn = ref(false)
export function refreshVaultOn(): void {
  vaultOn.value = !!vaultMeta() && !isLocked()
}

type Msg = { t: 'lock' } | { t: 'ask' } | { t: 'keys'; keys: VaultKeys } | { t: 'act' } | { t: 'shown' }
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ngg-vault') : null
const keyWaiters = new Set<(k: VaultKeys) => void>()

let locking = false
/** Lock this tab: save, then reload onto the lock screen. */
async function lockHere(): Promise<void> {
  if (locking || !vaultMeta() || isLocked()) return
  locking = true
  document.documentElement.classList.add('is-covered')
  try {
    await persistNow()
  } catch {
    /* told already (persist); locking matters more */
  }
  freezeStorage()
  window.location.reload()
}
/** Lock every tab of the app now. */
export function lockNow(): void {
  channel?.postMessage({ t: 'lock' } satisfies Msg)
  void lockHere()
}

/** The keys of another tab that is unlocked, if one answers soon. */
export function keysFromOtherTab(wait = 350): Promise<VaultKeys | null> {
  if (!channel) return Promise.resolve(null)
  return new Promise((resolve) => {
    const done = (k: VaultKeys | null) => {
      keyWaiters.delete(take)
      clearTimeout(timer)
      resolve(k)
    }
    const take = (k: VaultKeys) => done(k)
    keyWaiters.add(take)
    const timer = setTimeout(() => done(null), wait)
    channel.postMessage({ t: 'ask' } satisfies Msg)
  })
}
/** Called with the keys when another tab unlocks while this one shows its lock screen. */
export function onKeysFromOtherTab(fn: (k: VaultKeys) => void): () => void {
  keyWaiters.add(fn)
  return () => keyWaiters.delete(fn)
}
/** Tell the other tabs on their lock screen (this tab has just been unlocked). */
export function shareKeys(): void {
  const keys = vaultKeys()
  if (keys) channel?.postMessage({ t: 'keys', keys } satisfies Msg)
}

// ---------- auto-lock ----------
export interface LockPrefs {
  /** Minutes without use (0: never). */
  idle: number
  /** Minutes in the background (0: at once, -1: never). */
  hidden: number
  /** Cover the content while in the background. */
  cover: boolean
}
let prefs: () => LockPrefs = () => ({ idle: 0, hidden: -1, cover: false })
let lastUse = Date.now()
/** Last moment any tab of the app was in front. */
let lastShown = Date.now()
let lastSent = 0

const shown = () => document.visibilityState === 'visible'
/** A playing video or a running slideshow: watching counts as use. */
function busy(): boolean {
  for (const v of document.querySelectorAll('video')) if (!v.paused && !v.ended) return true
  return !!document.querySelector('[data-slideshow="on"]')
}
function used() {
  const t = Date.now()
  lastUse = t
  if (t - lastSent > 15_000) {
    lastSent = t
    channel?.postMessage({ t: 'act' } satisfies Msg)
  }
}
function tooLongHidden(t: number): boolean {
  const p = prefs()
  return p.hidden >= 0 && t - lastShown >= Math.max(p.hidden * 60_000, 1500)
}
function check() {
  if (!vaultMeta() || isLocked()) return
  const t = Date.now()
  if (shown()) {
    lastShown = t
    channel?.postMessage({ t: 'shown' } satisfies Msg)
    if (busy()) used()
  }
  const p = prefs()
  if (p.idle > 0 && t - lastUse >= p.idle * 60_000) return lockNow()
  if (!shown() && tooLongHidden(t)) lockNow()
}
function cover(on: boolean) {
  document.documentElement.classList.toggle('is-covered', on)
}

let started = false
/** Start auto-lock and the cover, once the app is unlocked (or open, without encryption: the cover
    alone). `get` reads the settings as they are now. */
export function startLock(get: () => LockPrefs): void {
  prefs = get
  if (started) return
  started = true
  lastUse = lastShown = Date.now()
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, used, { passive: true, capture: true })
  window.addEventListener('scroll', used, { passive: true, capture: true })
  setInterval(check, 10_000)
  document.addEventListener('visibilitychange', () => {
    const t = Date.now()
    const vault = !!vaultMeta() && !isLocked()
    if (shown()) {
      // Back in front: a lock that is due happens before anything shows again.
      if (vault && tooLongHidden(t)) return lockNow()
      lastShown = t
      channel?.postMessage({ t: 'shown' } satisfies Msg)
      cover(false)
      return
    }
    lastShown = t
    if (prefs().cover || (vault && prefs().hidden === 0)) cover(true)
    // "At once": unless another tab of the app comes to the front meanwhile (switching tabs).
    if (vault) setTimeout(check, 1600)
  })
  // Hidden by the system (a phone's app switcher), without visibilitychange yet.
  window.addEventListener('pagehide', () => prefs().cover && cover(true))
}

channel?.addEventListener('message', (e: MessageEvent<Msg>) => {
  const m = e.data
  if (!m || typeof m !== 'object') return
  if (m.t === 'lock') void lockHere()
  else if (m.t === 'ask') shareKeys()
  else if (m.t === 'keys' && isLocked()) for (const fn of [...keyWaiters]) fn(m.keys)
  else if (m.t === 'act') lastUse = Date.now()
  else if (m.t === 'shown') lastShown = Date.now()
})
