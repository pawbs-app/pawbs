// The check page (check.html), served at /check, and at /sync/v1/check where app versions 1.9.17 and
// before open it. The CDN in front of the site (Cloudflare) may hold this browser's requests for a
// check that only a page opened in the browser can show and pass, and it may hold the transfer relay
// (/sync/) and the rest of the site apart: a rule can let one through and not the other. Loaded, this
// page got past whatever held its own address. It asks both; when the other one is still held, it goes
// to the check page there, where the check shows (once: "from" marks the hop). When nothing is held,
// it tells the app's open pages (they ask again at once) and closes the tab, which the app opened
// with window.open so that it may.
;(async () => {
  const say = (state) => (document.documentElement.dataset.state = state)
  const atRelay = /\/sync\/v1\/check$/.test(location.pathname)
  const root = new URL(atRelay ? '../../' : './', location.href).href
  const hopped = new URLSearchParams(location.search).has('from')
  // 'held': the CDN's check came back instead of an answer; 'ok': the server answered; 'off': nothing did.
  const ask = async (path, method = 'GET') => {
    try {
      const res = await fetch(root + path, { method, cache: 'no-store', credentials: 'same-origin' })
      return res.status === 403 || res.headers.get('cf-mitigated') ? 'held' : 'ok'
    } catch {
      return 'off'
    }
  }
  const [site, relay] = await Promise.all([ask('sw.js', 'HEAD'), ask('sync/v1/health')])
  if (!hopped) {
    // "/sync/" in the address gets it past the service worker of app versions 1.9.17 and before, which
    // answers every other page address with the app itself, to the network, where the check shows.
    if (site === 'held' && atRelay) return location.replace(root + 'check?from=/sync/v1/check')
    if (relay === 'held' && !atRelay) return location.replace(root + 'sync/v1/check?from=/check')
  }
  if (site === 'held' || relay === 'held') return say('fail')
  if (site === 'off') return say('off')
  say('ok')
  try {
    // Named when this page only checked the relay: the apps of every version listen to it.
    const ch = new BroadcastChannel('nggallery-relay')
    ch.postMessage('passed')
    ch.close()
  } catch {
    /* the app asks again when it is shown anyway */
  }
  setTimeout(() => window.close(), 1200)
})()
