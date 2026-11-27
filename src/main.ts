import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router, prefetchViews } from './router'
import { useSites } from './stores/sites'
import { initStorage, isLocked, persistNow } from './stores/persist'
import { unlockFirst } from './lockScreen'
import { moveSavedSearches, shareBoardData } from './stores/boardData'
import { warmUp } from './api/client'
import { watchOwnRequests } from './services/held'
import { startAppFullscreen } from './services/appFullscreen'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'
import './styles/fx.css'

// Development builds blur every post picture (screenshots, screen sharing); production never does.
if (import.meta.env.DEV) document.documentElement.classList.add('dev-blur')

// Phones: the page itself does not zoom (a pinch on a grid or the feed, or anything wider than the
// screen, left it zoomed in or out); the gallery zooms its pictures itself. Tablets and computers keep
// the browser's zoom. A browser set to zoom every page anyway (an accessibility setting) still can.
if (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600) {
  const vp = document.querySelector<HTMLMetaElement>('meta[name=viewport]')
  if (vp && !/user-scalable/.test(vp.content)) vp.content += ', minimum-scale=1, maximum-scale=1, user-scalable=no'
}

/* A page left open across a deploy may ask for parts of the old version, which the server no longer
   has: reload onto the new version instead of failing (at most once a minute, to never loop). */
function reloadForStaleBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem('ngg:stale-reload') ?? 0)
    if (Date.now() - last < 60_000) return false
    sessionStorage.setItem('ngg:stale-reload', String(Date.now()))
  } catch {
    /* no session storage: still try once */
  }
  // The last changes on disk first: a reload can cut a save short.
  void persistNow()
    .catch(() => {})
    .finally(() => window.location.reload())
  return true
}
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForStaleBuild()) e.preventDefault()
})

// Stored data is read into memory before any store or view asks for it (stores/persist); what e621
// and e926 still keep apart is merged into their shared set first (stores/boardData).
await initStorage()
// Encrypted (Settings › Privacy): nothing is read until the lock screen opens the store.
if (isLocked()) await unlockFirst()
shareBoardData()
moveSavedSearches()

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
// Requests to this server held back by the CDN's bot check raise a notice (services/held).
watchOwnRequests()
// Open the site's connections now, while the rest of the app starts: the first search and its
// thumbnails then find them ready.
warmUp(useSites(pinia).active?.url)
app.use(router)
router.onError((err) => {
  if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(String((err as Error)?.message ?? err))) reloadForStaleBuild()
})
// The page's own text (index.html, #landing) leaves with the loader; the router brings it back
// under the first screen of a first visit.
document.documentElement.classList.add('app-on')
app.mount('#app')
// iOS shows a control's pressed look (:active) only on a page that listens for touches.
document.addEventListener('touchstart', () => {}, { passive: true })
// Full screen for the whole app, where it was chosen on this device (Settings › Browsing).
startAppFullscreen()
router.isReady().then(prefetchViews)
