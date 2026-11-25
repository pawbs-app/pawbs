/* Smart preloading. Callers declare what they will want soon ("the viewer window", "the hovered
   thumbnail") with a priority; the preloader fetches and decodes the most urgent first, a few at a
   time, cancels what is no longer wanted, and keeps recently decoded images so stepping back is
   instant. Images are decoded before they are shown, so a swap never stutters. */
import { recordLoadTime } from './netinfo'

interface Entry {
  url: string
  img: HTMLImageElement | null
  priority: number
  state: 'queued' | 'loading' | 'ready' | 'error'
  promise: Promise<boolean>
  resolve: (ok: boolean) => void
  started: number
  used: number
}

const entries = new Map<string, Entry>()
const groups = new Map<string, Map<string, number>>()
const MAX_ACTIVE = 4
const KEEP_READY = 18
let active = 0

/* The post on screen comes first. While it is loading, no preload starts (they would share the
   connection with it, the next video above all), and only it is fetched at high priority. The viewer
   holds preloads until its picture is decoded or its video can play; a load that stalls releases them
   after a few seconds anyway. */
const HOLD_MAX = 6000
let held = false
let holdTimer: number | null = null
export function holdPreloads(on: boolean) {
  if (holdTimer != null) clearTimeout(holdTimer)
  holdTimer = null
  if (on === held) return
  held = on
  if (on) {
    holdTimer = window.setTimeout(() => holdPreloads(false), HOLD_MAX)
    return
  }
  pump()
  if (lastVideos) wantVideos(...lastVideos) // the videos held back
}

function wantedPriority(url: string): number | null {
  let best: number | null = null
  for (const g of groups.values()) {
    const p = g.get(url)
    if (p !== undefined && (best === null || p < best)) best = p
  }
  return best
}

function ensureEntry(url: string, priority: number): Entry {
  let e = entries.get(url)
  if (!e) {
    let resolve!: (ok: boolean) => void
    const promise = new Promise<boolean>((r) => (resolve = r))
    e = { url, img: null, priority, state: 'queued', promise, resolve, started: 0, used: performance.now() }
    entries.set(url, e)
  } else {
    e.priority = Math.min(e.priority, priority)
  }
  return e
}

function start(e: Entry) {
  e.state = 'loading'
  e.started = performance.now()
  active++
  const img = new Image()
  img.decoding = 'async'
  // High for what is on screen (or asked for directly) only: the next picture is not as urgent.
  ;(img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = e.priority < 1 ? 'high' : 'low'
  e.img = img
  const finish = (ok: boolean) => {
    if (e.state !== 'loading') return
    active--
    e.state = ok ? 'ready' : 'error'
    if (ok) recordLoadTime(performance.now() - e.started)
    e.resolve(ok)
    pump()
  }
  img.onload = () => {
    img.decode().then(
      () => finish(true),
      () => finish(true),
    )
  }
  img.onerror = () => finish(false)
  img.src = e.url
}

function cancel(e: Entry) {
  if (e.state === 'loading' && e.img) {
    e.img.onload = null
    e.img.onerror = null
    e.img.src = ''
    active--
  }
  // Not "loading" any more: a decode already under way finishes into nothing (finish() would
  // otherwise count this load out a second time, and the limit of loads at once drifted away).
  e.state = 'error'
  e.resolve(false)
  entries.delete(e.url)
}

function pump() {
  // Drop queued or loading entries nobody wants anymore.
  for (const e of [...entries.values()]) {
    const p = wantedPriority(e.url)
    if (p === null) {
      if (e.state === 'queued' || (e.state === 'loading' && e.priority > 0)) cancel(e)
    } else e.priority = p
  }
  // Keep a bounded set of decoded images: the wanted ones and the most recently used.
  const ready = [...entries.values()].filter((e) => e.state === 'ready' || e.state === 'error')
  if (ready.length > KEEP_READY) {
    ready
      .filter((e) => wantedPriority(e.url) === null)
      .sort((a, b) => a.used - b.used)
      .slice(0, ready.length - KEEP_READY)
      .forEach((e) => entries.delete(e.url))
  }
  const queue = [...entries.values()].filter((e) => e.state === 'queued').sort((a, b) => a.priority - b.priority)
  for (const e of queue) {
    // The most urgent load may always start; others wait for a free slot, and for the post on
    // screen to be loaded.
    if (e.priority > 0 && (held || active >= MAX_ACTIVE)) break
    start(e)
  }
}

/** Replace what a group wants. Lower priority numbers load first (0 = on screen now). */
export function want(group: string, list: { url: string | null | undefined; priority: number }[]) {
  const m = new Map<string, number>()
  for (const { url, priority } of list) {
    if (!url) continue
    const prev = m.get(url)
    if (prev === undefined || priority < prev) m.set(url, priority)
    ensureEntry(url, priority)
  }
  groups.set(group, m)
  pump()
}

export function release(group: string) {
  groups.delete(group)
  pump()
}

/** Is this image already fetched and decoded? */
export function isReady(url: string | null | undefined): boolean {
  if (!url) return false
  const e = entries.get(url)
  if (e?.state === 'ready') {
    e.used = performance.now()
    return true
  }
  return false
}

/** Wait for an image (starting it at top priority if nothing asked for it yet). */
const direct: string[] = []
export function whenReady(url: string): Promise<boolean> {
  const existing = entries.get(url)
  if (existing && existing.state !== 'queued') return existing.promise
  // Keep the last few direct requests wanted so the pump does not drop them.
  if (!direct.includes(url)) {
    direct.push(url)
    if (direct.length > 3) direct.shift()
  }
  want(
    'direct',
    direct.map((u) => ({ url: u, priority: 0 })),
  )
  return entries.get(url)!.promise
}

// ---- hover hints ----
let hoverTimer: number | null = null
/** Warm the image behind a thumbnail after a short hover (intent, not a fly-over). */
export function hint(url: string | null | undefined, delay = 90) {
  if (hoverTimer != null) clearTimeout(hoverTimer)
  if (!url) return
  hoverTimer = window.setTimeout(() => want('hover', [{ url, priority: 2 }]), delay)
}
export function unhint() {
  if (hoverTimer != null) clearTimeout(hoverTimer)
  hoverTimer = null
}

/* ---------- Videos ----------
   A few hidden <video> elements load the videos the viewer will show next. The viewer does not load
   them again: it adopts the element itself (takeVideo), with what is buffered and its first frame
   decoded, so playback starts at once; when it leaves the post it hands the element back
   (giveBackVideo), and stepping back is instant too. Videos no longer wanted are dropped. */
type VideoMode = 'none' | 'metadata' | 'auto'
const videoPool = new Map<string, HTMLVideoElement>()
const lent = new Set<string>()
let wantedVideos = new Set<string>()
let videoMode: VideoMode = 'none'
/** The last call, made again when held videos may start. */
let lastVideos: [(string | null | undefined)[], VideoMode] | null = null

function dropVideo(el: HTMLVideoElement) {
  el.pause()
  el.removeAttribute('src')
  el.load() // releases the connection and the buffer
}

/** The videos to hold ready (the current post's first, so it is never dropped before adoption). */
export function wantVideos(urls: (string | null | undefined)[], mode: VideoMode) {
  lastVideos = [urls, mode]
  videoMode = mode
  wantedVideos = new Set(mode === 'none' ? [] : urls.filter((u): u is string => !!u))
  for (const [url, el] of videoPool) {
    if (!wantedVideos.has(url)) {
      dropVideo(el)
      videoPool.delete(url)
    } else if (el.preload !== mode) el.preload = mode
  }
  for (const url of wantedVideos) {
    if (videoPool.has(url) || lent.has(url)) continue
    // Only the post on screen's own video while it is loading (see holdPreloads).
    if (held && url !== urls[0]) continue
    const el = document.createElement('video')
    el.muted = true
    el.playsInline = true
    el.preload = mode
    el.src = url
    videoPool.set(url, el)
  }
}

/** One video ahead (kept for older callers). */
export function wantVideo(url: string | null, mode: VideoMode) {
  wantVideos([url], mode)
}

/** The preloaded element for this file, if any: it now belongs to the caller. Either way the file
    counts as in use (an element the caller makes itself is not loaded twice, and comes back here). */
export function takeVideo(url: string): HTMLVideoElement | null {
  lent.add(url)
  const el = videoPool.get(url)
  if (!el) return null
  videoPool.delete(url)
  return el
}

/** An element the caller is done with: kept (rewound) if that video is still wanted, else dropped. */
export function giveBackVideo(url: string, el: HTMLVideoElement) {
  lent.delete(url)
  el.remove()
  // (Not one that failed: handed out again it would only fail again, with no new attempt at the file.)
  if (wantedVideos.has(url) && videoMode !== 'none' && !videoPool.has(url) && el.getAttribute('src') === url && !el.error) {
    el.pause()
    el.muted = true
    try {
      el.currentTime = 0
    } catch {
      /* not seekable yet */
    }
    videoPool.set(url, el)
  } else dropVideo(el)
}

export function preloaderStats() {
  const list = [...entries.values()]
  return {
    ready: list.filter((e) => e.state === 'ready').length,
    loading: list.filter((e) => e.state === 'loading').length,
    queued: list.filter((e) => e.state === 'queued').length,
  }
}
