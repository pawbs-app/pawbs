/* The CDN in front of this app's server (Cloudflare) can hold this browser's requests for a check
   that only a page opened in the browser can pass: it answers 403 (with cf-mitigated: challenge)
   instead. Held, the app cannot reach its own server: no updates (sw.js), no transfers between
   devices. Every request to this server is watched for it (the site's API is another server, its
   answers say nothing about this one); a probe of sw.js, past every cache, checks again and clears it.
   ui.held drives the notice in Settings and the mark on the title bar's settings button. */
import { useUi } from '@/stores/ui'

let realFetch: typeof fetch | null = null

const isHeld = (res: Response) => res.status === 403 || !!res.headers.get('cf-mitigated')
function isOwn(input: RequestInfo | URL): boolean {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return new URL(url, location.href).origin === location.origin
  } catch {
    return false
  }
}

/** From now on, a request to this server answered with a hold raises ui.held. */
export function watchOwnRequests() {
  if (realFetch) return
  const real = (realFetch = window.fetch.bind(window))
  window.fetch = async (input, init) => {
    const res = await real(input, init)
    if (isHeld(res) && isOwn(input)) useUi().held = true
    return res
  }
}

/** Asks this server for sw.js past every cache: held raises ui.held, an answer clears it, no answer
    (offline) leaves it as it is. */
export async function checkOwnServer(): Promise<void> {
  const f = realFetch ?? window.fetch.bind(window)
  try {
    const res = await f(new URL('sw.js', new URL('.', document.baseURI)).href, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' })
    useUi().held = isHeld(res)
  } catch {
    /* no answer: says nothing about a check */
  }
}

/** Opens the check page (deploy/check/), where the CDN's check shows and can be passed. It sits outside
    the relay's addresses, which a CDN rule may let through while it holds the rest; it checks both,
    and closes itself once neither is held (opened by script so that it may). */
export function openCheck() {
  window.open(new URL('check', new URL('.', document.baseURI)).href, 'nggallery-check')
}

/** Calls back when the check page reports that nothing is held any more; returns the way to stop. */
export function onCheckPassed(cb: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  // Named when the page only checked the relay: the page and the apps of every version use it.
  const ch = new BroadcastChannel('nggallery-relay')
  ch.onmessage = (e) => e.data === 'passed' && cb()
  return () => ch.close()
}
