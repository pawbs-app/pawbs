/* When the site, not this device, is the problem: what the API client sees (api/client), summed up for
   the notice that says so (components/SiteTrouble).
   - auth: the site refused the account's API key (401): expired, deleted on the site, or mistyped.
   - blocked: its protection turned requests away (403 with a web page instead of an answer). A web
     app cannot pass its visitor check (its requests carry no cookies), so it can only wait.
   - down: errors on its side (5xx), still there after the client's own retries.
   - unreachable: no answer at all, while this device is online and this app's own server answers.
   Two failures in a row make a trouble (one refused key does), and the first good answer ends it.
   While the site is blocked, down or unreachable, requests made in the background (follow checks,
   tag categories) are left out, but for one a minute, which ends it once the site is back. */
import { reactive } from 'vue'

export type Trouble = 'auth' | 'blocked' | 'down' | 'unreachable'

export const siteHealth = reactive({
  /** The site's address, as in Settings › Sites. */
  site: '',
  kind: null as Trouble | null,
  /** The last error status (for down). */
  status: 0,
  /** Closed by the person: hidden until the next trouble. */
  hidden: false,
})

let fails = 0
let failSite = ''
let lastBackground = 0

function raise(site: string, kind: Trouble, status = 0) {
  if (siteHealth.site === site && siteHealth.kind === kind) {
    if (status) siteHealth.status = status
    return
  }
  Object.assign(siteHealth, { site, kind, status, hidden: false })
}

/** A good answer: ends a trouble of that site (a refused key, only an answer given with the key). */
export function noteOk(site: string, withKey: boolean) {
  if (failSite === site) fails = 0
  if (siteHealth.site !== site || !siteHealth.kind) return
  if (siteHealth.kind === 'auth' && !withKey) return
  siteHealth.kind = null
}

/** The site refused the account's key. */
export function noteKeyRefused(site: string) {
  raise(site, 'auth')
}

/** A failed request, after the client's own retries. */
export async function noteFailure(site: string, kind: 'blocked' | 'down' | 'no-answer', status = 0) {
  if (failSite !== site) {
    failSite = site
    fails = 0
  }
  fails++
  if (fails < 2) return
  if (kind !== 'no-answer') return raise(site, kind, status)
  // No answer: the site's side only if this device is online and this app's server answers.
  if (navigator.onLine === false || !(await ownServerAnswers())) return
  // (A good answer from the site may have come meanwhile.)
  if (fails >= 2 && failSite === site) raise(site, 'unreachable')
}

/** Whether a background request may go to this site now (see the top). */
export function backgroundAllowed(site: string): boolean {
  if (!siteHealth.kind || siteHealth.kind === 'auth' || siteHealth.site !== site) return true
  const now = Date.now()
  if (now - lastBackground < 60_000) return false
  lastBackground = now
  return true
}

/** Any answer from this app's own server (whatever it says) means the connection works. */
async function ownServerAnswers(): Promise<boolean> {
  try {
    await fetch(new URL('healthz', new URL('.', location.href)).href, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(8000) })
    return true
  } catch {
    return false
  }
}
