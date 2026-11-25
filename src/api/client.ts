/* The one way the app talks to a site: a small scheduler that keeps under the site's rate limit,
   serves the most urgent request first, merges identical requests in flight and keeps GET answers
   for a short while. Every request goes straight from the browser to the site's API. */

export const APP_VERSION: string = __APP_VERSION__
/* Who is asking, on every request (`_client`: a browser cannot set its User-Agent), with a way to reach
   the app's maker: what the sites' API rules ask of a client. */
const CLIENT_ID = `NgGallery/${APP_VERSION} (contact@pawbs.app)`

export interface SiteAuth {
  username: string
  apiKey: string
}

export interface SiteEndpoint {
  url: string
  auth?: SiteAuth | null
}

/** Lower runs first. */
export enum Priority {
  User = 0,
  Viewer = 1,
  Suggest = 2,
  Background = 3,
  Idle = 4,
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH'
  params?: Record<string, string | number | boolean | undefined | null>
  /** Form fields; an array is sent as repeated fields (`post_ids[]`). */
  body?: Record<string, string | number | boolean | undefined | null | (string | number)[]>
  priority?: Priority
  signal?: AbortSignal
  /** Send the account with this request (needs a preflight, so it costs a round trip). */
  auth?: boolean
  /** Cache a GET answer for this many ms (default 60 s, 0 to skip). */
  ttl?: number
}

interface Job {
  priority: number
  seq: number
  run: () => void
  signal?: AbortSignal
  /** Called instead of run when the job is cancelled while still waiting: its promise must settle. */
  drop: () => void
}

/** Token bucket: about two requests a second, with a small burst. */
class Scheduler {
  private queue: Job[] = []
  private tokens = 3
  private readonly capacity = 3
  private readonly ratePerMs = 2 / 1000
  private last = performance.now()
  private timer: number | null = null
  private seq = 0
  private active = 0
  private readonly maxActive = 4

  schedule(priority: number, run: () => Promise<void>, signal: AbortSignal | undefined, drop: () => void): void {
    const job: Job = {
      priority,
      seq: this.seq++,
      signal,
      drop,
      run: () => {
        this.active++
        run().finally(() => {
          this.active--
          this.pump()
        })
      },
    }
    this.queue.push(job)
    this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq)
    // Cancelled while waiting: out of the queue and settled at once (not at the next pump, which may
    // be seconds away when the budget is spent).
    signal?.addEventListener(
      'abort',
      () => {
        const i = this.queue.indexOf(job)
        if (i < 0) return
        this.queue.splice(i, 1)
        job.drop()
      },
      { once: true },
    )
    this.pump()
  }

  private refill() {
    const now = performance.now()
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.ratePerMs)
    this.last = now
  }

  private pump() {
    // (Jobs cancelled before they were queued.) A dropped job's promise is settled, never forgotten:
    // an unsettled one stayed "in flight" for good, and every later identical request waited on it.
    this.queue = this.queue.filter((j) => {
      if (!j.signal?.aborted) return true
      j.drop()
      return false
    })
    while (this.queue.length && this.active < this.maxActive) {
      this.refill()
      if (this.tokens < 1) {
        if (this.timer == null) {
          const wait = Math.ceil((1 - this.tokens) / this.ratePerMs)
          this.timer = window.setTimeout(() => {
            this.timer = null
            this.pump()
          }, wait)
        }
        return
      }
      this.tokens -= 1
      const job = this.queue.shift()!
      job.run()
    }
  }

  /** Back off after the site says "too many requests". */
  penalize(ms: number) {
    this.tokens = Math.min(this.tokens, -ms * this.ratePerMs)
  }
}

/** How long a request may take, answer included (a page of 320 posts on a slow phone connection fits). */
const REQUEST_TIMEOUT_MS = 30_000

const scheduler = new Scheduler()
const inflight = new Map<string, Promise<unknown>>()
const cache = new Map<string, { at: number; ttl: number; data: unknown }>()
const CACHE_MAX = 300

/* A reload the person asked for (Reload, pull down at the top) wants the site's answer now, not the
   one kept from a minute ago: for a few seconds kept answers are not used (new ones are still kept). */
let freshUntil = 0
export function freshAnswers(ms = 4000) {
  freshUntil = performance.now() + ms
}

function cacheGet(key: string): unknown | undefined {
  if (performance.now() < freshUntil) return undefined
  const hit = cache.get(key)
  if (!hit) return undefined
  if (performance.now() - hit.at > hit.ttl) {
    cache.delete(key)
    return undefined
  }
  return hit.data
}

function cacheSet(key: string, data: unknown, ttl: number) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(key, { at: performance.now(), ttl, data })
}

export function clearApiCache() {
  cache.clear()
}

export function normalizeSiteUrl(input: string): string {
  let s = input.trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  try {
    const u = new URL(s)
    // A host name, or nothing: some browsers take "exa mple.com" and encode the space into the name.
    if (u.hostname.includes('%')) return ''
    // Keep a path prefix if the API lives below the root, but drop page paths people paste.
    let path = u.pathname.replace(/\/+$/, '')
    path = path.replace(/\/(posts|post|pools|tags|wiki_pages|favorites|popular|explore)(\/.*)?$/i, '')
    path = path.replace(/\.json$/i, '')
    return `${u.protocol}//${u.host}${path}`
  } catch {
    return ''
  }
}

function encodeParams(params: RequestOptions['params']): string {
  const sp = new URLSearchParams()
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue
      sp.append(k, String(v))
    }
  }
  sp.append('_client', CLIENT_ID)
  return sp.toString()
}

function authHeader(auth: SiteAuth): string {
  const raw = `${auth.username}:${auth.apiKey}`
  // btoa needs Latin-1; encode UTF-8 names safely.
  const bytes = new TextEncoder().encode(raw)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return 'Basic ' + btoa(bin)
}

function messageFor(status: number, body: unknown): string {
  const j = body as Record<string, unknown> | null
  const fromBody = j && typeof j === 'object' ? (j.message ?? j.reason ?? (Array.isArray(j.errors) ? j.errors.join(', ') : null)) : null
  const detail = typeof fromBody === 'string' && fromBody && !fromBody.startsWith('SessionLoader') ? ` · ${fromBody}` : ''
  switch (status) {
    case 401:
      return 'The site refused the account: check the user name and API key' + detail
    case 403:
      return 'The site refused this request' + detail
    case 404:
      // The site's own wording ("not found") would only repeat it.
      return 'Not found on the site' + (/not found/i.test(detail) ? '' : detail)
    case 410:
      return 'Past the last page the site allows' + detail
    case 421:
    case 429:
      return 'The site is limiting requests: wait a few seconds and retry'
    case 422:
      return 'The site could not read the request' + detail
    case 500:
      return 'The site failed to answer (error 500)' + detail
    case 502:
    case 503:
    case 504:
      return `The site is busy or down (error ${status})`
    default:
      return `The site answered ${status}` + detail
  }
}

export async function apiRequest<T = unknown>(site: SiteEndpoint, path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  // Only ever to a web address: with none, the request would go to this app's own server instead.
  if (!/^https?:\/\//i.test(site.url)) throw new ApiError(0, 'This site has no address: edit it in Settings › Sites')
  if (!currentSite) warmUp(site.url)
  const useAuth = !!(opts.auth && site.auth?.username && site.auth?.apiKey)
  const url = `${site.url}${path}?${encodeParams(opts.params)}`
  const key = `${method} ${url} ${useAuth ? site.auth!.username : ''}`
  const ttl = opts.ttl ?? 60_000

  if (method === 'GET' && ttl > 0) {
    const hit = cacheGet(key)
    if (hit !== undefined) return hit as T
    const pending = inflight.get(key)
    // The same request already on its way: share it. If whoever started it cancels it, this caller
    // (not cancelled itself) asks again on its own instead of getting the cancellation.
    if (pending) {
      return (pending as Promise<T>).catch((e: unknown) => {
        if ((e as Error)?.name === 'AbortError' && !opts.signal?.aborted) return apiRequest<T>(site, path, opts)
        throw e
      })
    }
  }

  const promise = new Promise<T>((resolve, reject) => {
    const attempt = (tries: number) => {
      scheduler.schedule(
        opts.priority ?? Priority.User,
        async () => {
          if (opts.signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          const headers: Record<string, string> = { Accept: 'application/json' }
          let body: string | undefined
          if (useAuth) headers.Authorization = authHeader(site.auth!)
          if (opts.body) {
            const sp = new URLSearchParams()
            for (const [k, v] of Object.entries(opts.body)) {
              if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)))
              else if (v !== undefined && v !== null) sp.append(k, String(v))
            }
            body = sp.toString()
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
          }
          let res: Response
          // What the user is waiting for goes ahead of the thumbnails sharing the network; prefetches
          // and background checks step aside.
          const p = opts.priority ?? Priority.User
          const fetchPriority: RequestPriority = p <= Priority.Viewer ? 'high' : p >= Priority.Background ? 'low' : 'auto'
          // A connection that stalls (a network handover, a captive portal) never ends by itself: four
          // of those would fill the scheduler and hold every later request behind them.
          const limit = new AbortController()
          let timedOut = false
          const timer = setTimeout(() => {
            timedOut = true
            limit.abort()
          }, REQUEST_TIMEOUT_MS)
          const cancel = () => limit.abort()
          if (opts.signal?.aborted) limit.abort()
          else opts.signal?.addEventListener('abort', cancel, { once: true })
          const release = () => {
            clearTimeout(timer)
            opts.signal?.removeEventListener('abort', cancel)
          }
          try {
            res = await fetch(url, {
              method,
              headers,
              body,
              signal: limit.signal,
              credentials: 'omit',
              referrerPolicy: 'strict-origin-when-cross-origin',
              priority: fetchPriority,
            })
          } catch (e) {
            release()
            if ((e as Error).name === 'AbortError' && !timedOut) return reject(e)
            if (tries < 1 && method === 'GET') {
              setTimeout(() => attempt(tries + 1), 800)
              return
            }
            return reject(
              new ApiError(
                0,
                navigator.onLine === false
                  ? 'Offline: this device has no connection. Retry once it is back.'
                  : timedOut
                    ? 'The site took too long to answer: check your connection and retry'
                    : 'No answer from the site: check the address and your connection',
              ),
            )
          }
          // A body cut off on the way is a failed request, not an empty answer (which would be cached
          // and taken for "no posts", "no tags" for minutes).
          let text: string
          try {
            text = await res.text()
          } catch (e) {
            release()
            if ((e as Error).name === 'AbortError' && !timedOut) return reject(e)
            if (tries < 1 && method === 'GET') {
              setTimeout(() => attempt(tries + 1), 800)
              return
            }
            return reject(new ApiError(0, 'The answer from the site was cut off: check your connection'))
          }
          release()
          let data: unknown = null
          if (text) {
            try {
              data = JSON.parse(text)
            } catch {
              data = null
            }
          }
          if (!res.ok) {
            if ((res.status === 429 || res.status === 503 || res.status === 421) && tries < 2 && method === 'GET') {
              scheduler.penalize(1500 * (tries + 1))
              setTimeout(() => attempt(tries + 1), 1500 * (tries + 1))
              return
            }
            return reject(new ApiError(res.status, messageFor(res.status, data)))
          }
          if (data === null && method === 'GET') {
            return reject(new ApiError(res.status, text ? 'No gallery answered at this address' : 'The site sent an empty answer'))
          }
          if (method === 'GET' && ttl > 0) cacheSet(key, data, ttl)
          resolve(data as T)
        },
        opts.signal,
        () => reject(new DOMException('Aborted', 'AbortError')),
      )
    }
    attempt(0)
  })

  if (method === 'GET') {
    inflight.set(key, promise)
    const forget = () => {
      if (inflight.get(key) === promise) inflight.delete(key)
    }
    promise.finally(forget).catch(() => {})
    // Cancelled: new callers start afresh rather than joining it.
    opts.signal?.addEventListener('abort', forget, { once: true })
  }
  return promise
}

/* ---------- Connections ----------
   Browsers keep one multiplexed HTTP/2 or HTTP/3 connection per host open by themselves; what the
   app can do is open it before the first request needs it, and open the right one: API calls (fetch
   without credentials) and pictures (<img>, <video>) travel on separate connection pools, so each
   host is warmed for the kind of traffic it gets, never both (a second, unused handshake). */
type ConnKind = 'api' | 'media'
const warmed = new Map<string, HTMLLinkElement>()
export function preconnect(url: string | null | undefined, kind: ConnKind = 'media') {
  if (!url) return
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return
  }
  const key = `${kind} ${origin}`
  if (warmed.has(key)) return
  const link = document.createElement('link')
  link.rel = 'preconnect'
  link.href = origin
  if (kind === 'api') link.crossOrigin = 'anonymous'
  document.head.appendChild(link)
  warmed.set(key, link)
}

/* The hosts a site serves its files from, remembered per site, so the next start opens them along
   with the API instead of after the first answer (the first thumbnails then skip a handshake). */
const MEDIA_HOSTS_KEY = 'ngg:media-hosts'
let currentSite = ''
function readHosts(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(MEDIA_HOSTS_KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}
export function rememberMediaHost(fileUrl: string | null | undefined) {
  if (!fileUrl || !currentSite) return
  let origin: string
  try {
    origin = new URL(fileUrl).origin
  } catch {
    return
  }
  preconnect(origin, 'media')
  const all = readHosts()
  const list = all[currentSite] ?? []
  if (list[0] === origin) return
  all[currentSite] = [origin, ...list.filter((o) => o !== origin)].slice(0, 3)
  try {
    localStorage.setItem(MEDIA_HOSTS_KEY, JSON.stringify(all))
  } catch {
    /* storage full or blocked: only the head start is lost */
  }
}
/** Open the connections a site will need: its API, and the file hosts it used last time. */
export function warmUp(siteUrl: string | null | undefined) {
  if (!siteUrl) return
  try {
    currentSite = new URL(siteUrl).origin
  } catch {
    return
  }
  preconnect(siteUrl, 'api')
  for (const host of readHosts()[currentSite] ?? []) preconnect(host, 'media')
}
/* Idle connections get closed (by the browser or the server) after a few minutes. When the page
   comes back into use (tab shown again, back online, first touch after a long pause), open them
   again ahead of the request that is about to follow. */
let lastUse = performance.now()
function rewarm() {
  for (const [key, link] of warmed) {
    const fresh = link.cloneNode() as HTMLLinkElement
    link.replaceWith(fresh)
    warmed.set(key, fresh)
  }
}
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rewarm()
  })
  window.addEventListener('online', rewarm)
  window.addEventListener(
    'pointerdown',
    () => {
      const now = performance.now()
      if (now - lastUse > 90_000) rewarm()
      lastUse = now
    },
    { capture: true, passive: true },
  )
}
