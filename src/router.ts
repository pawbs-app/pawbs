import { createRouter, createWebHashHistory, type RouteLocationNormalized } from 'vue-router'
import { useSites } from '@/stores/sites'
import { useSelection } from '@/stores/selection'
import { takeBack } from '@/services/backClose'
import HomeView from '@/views/HomeView.vue'
import PostsView from '@/views/PostsView.vue'

/* Hash history: the build works on any static host without rewrite rules. The viewer is an overlay
   driven by the "post" query on whichever list is showing, so closing it returns to the grid
   exactly as it was. */

const lazy = {
  favorites: () => import('@/views/FavoritesView.vue'),
  popular: () => import('@/views/PopularView.vue'),
  pools: () => import('@/views/PoolsView.vue'),
  pool: () => import('@/views/PoolView.vue'),
  following: () => import('@/views/FollowingView.vue'),
  history: () => import('@/views/HistoryView.vue'),
  settings: () => import('@/views/SettingsView.vue'),
  setup: () => import('@/views/SetupView.vue'),
  post: () => import('@/views/PostView.vue'),
  receive: () => import('@/views/ReceiveView.vue'),
  sets: () => import('@/views/SetsView.vue'),
  set: () => import('@/views/SetView.vue'),
  similar: () => import('@/views/SimilarView.vue'),
  collection: () => import('@/views/CollectionView.vue'),
}

/* Where a page was left by Back, Forward or an address typed over it. The router keeps the positions
   of the steps it makes itself; an address typed in the bar (or opened from outside) makes a step it
   knows nothing of, and going back over that one landed at the top of the page.
   `popped`: the browser's history just moved (set before the router's own listener runs: this one is
   added first), taken by the navigation that follows, as `navPop`; `popDelta`: by how many steps
   (negative: Back), where the router numbered them. */
const leftAt = new Map<string, number>()
let popped = false
let navPop = false
let popDelta = 0
let lastPos: number | undefined
/** The step Back just left was a pad (services/backClose): one on the same address as the step before. */
let fromPad = false
const posNow = () => (window.history.state as { position?: number } | null)?.position
window.addEventListener('popstate', () => {
  popped = true
  const p = posNow()
  popDelta = p != null && lastPos != null ? p - lastPos : 0
  // (The router has not seen the move yet: its state is still the step left.)
  fromPad = !!(router.options.history.state as { pad?: boolean } | null)?.pad
  // (A move the router makes itself and does not follow, taking a refused Back back, starts no
  // navigation: the mark must not wait for the next one.)
  setTimeout(() => (popped = false))
})

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { title: 'Home' } },
    { path: '/posts', name: 'posts', component: PostsView, meta: { title: 'Search' } },
    { path: '/post/:id(\\d+)', name: 'post', component: lazy.post, meta: { title: 'Post' } },
    { path: '/favorites', name: 'favorites', component: lazy.favorites, meta: { title: 'Favourites' } },
    { path: '/popular', name: 'popular', component: lazy.popular, meta: { title: 'Popular' } },
    { path: '/pools', name: 'pools', component: lazy.pools, meta: { title: 'Pools' } },
    { path: '/pools/:id(\\d+)', name: 'pool', component: lazy.pool, meta: { title: 'Pool' } },
    { path: '/following', name: 'following', component: lazy.following, meta: { title: 'Following' } },
    { path: '/sets', name: 'sets', component: lazy.sets, meta: { title: 'Sets' } },
    { path: '/sets/:id(\\d+)', name: 'set', component: lazy.set, meta: { title: 'Set' } },
    { path: '/collections', redirect: { path: '/sets', query: { tab: 'collections' } } },
    { path: '/collections/:id([a-z0-9]+)', name: 'collection', component: lazy.collection, meta: { title: 'Collection' } },
    { path: '/similar/:id(\\d+)', name: 'similar', component: lazy.similar, meta: { title: 'Similar pictures' } },
    { path: '/history', name: 'history', component: lazy.history, meta: { title: 'History' } },
    { path: '/settings/:section?', name: 'settings', component: lazy.settings, meta: { title: 'Settings', noSite: true } },
    { path: '/setup', name: 'setup', component: lazy.setup, meta: { title: 'Set up', noSite: true } },
    { path: '/receive', name: 'receive', component: lazy.receive, meta: { title: 'Receive', noSite: true } },
    { path: '/:rest(.*)*', redirect: '/' },
  ],
  scrollBehavior(to, from, saved) {
    // Opening, stepping through or closing the viewer never moves the page underneath.
    const pop = navPop
    navPop = false
    const kept = leftAt.get(to.fullPath)
    leftAt.delete(to.fullPath)
    if (to.path === from.path && onlyPostChanged(to, from)) return false
    const once = <T>(at: T) => new Promise<T>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(at))))
    // (Back to a page the router has no position for: where it was left, see leftAt.)
    if (pop && kept && !saved?.top) return once({ left: 0, top: kept })
    if (saved) return once(saved)
    if (to.path === from.path && to.query.q === from.query.q) return false
    return { top: 0 }
  },
})

function onlyPostChanged(a: RouteLocationNormalized, b: RouteLocationNormalized): boolean {
  // (`qa`: the query assistant's own step in the history, composables/assistant.)
  const ka = Object.keys(a.query).filter((k) => k !== 'post' && k !== 'qa')
  const kb = Object.keys(b.query).filter((k) => k !== 'post' && k !== 'qa')
  if (ka.length !== kb.length) return false
  return ka.every((k) => a.query[k] === b.query[k])
}

router.beforeEach((to, from) => {
  navPop = popped
  popped = false
  if (!navPop) return
  if (popDelta < 0) {
    // Off a pad onto the same page (services/backClose): the step is taken, the page stays as it is.
    const padBack = fromPad && to.fullPath === from.fullPath
    // Back with a sheet or a menu open over the page: that closes, the page stays (services/backClose).
    // Back with posts selected: out of the selection, and still on the page (a phone's or tablet's
    // Back is the way out of any mode; it used to leave the page and drop the selection with it).
    const selection = useSelection()
    const close = takeBack() ?? (selection.active ? () => selection.clear() : null)
    if (close) {
      close()
      navPop = false
      return padBack ? undefined : false
    }
    // A pad whose sheet was closed some other way: this Back goes on past it.
    if (padBack) {
      navPop = false
      setTimeout(() => window.history.back())
      return
    }
  }
  leftAt.set(from.fullPath, window.scrollY)
})
router.afterEach((_to, _from, failure) => {
  // (A refused Back is taken back by the router after this: the position it left is the one that
  // stands, not the one the browser shows right now.)
  if (failure) navPop = false
  else lastPos = posNow()
})

router.beforeEach((to) => {
  const sites = useSites()
  if (!sites.active && !to.meta.noSite) return { name: 'setup', query: to.query.site ? { site: to.query.site } : undefined }
})

/* The public name. Home and the first-visit page (set up, what search engines see) carry the full
   title of index.html; the rest put the page first. */
const BRAND = 'pawbs'
const FULL_TITLE = 'pawbs · fast, private e621 & e926 viewer and client'
router.afterEach((to) => {
  // A first visit (set up, no site yet): what pawbs is stays on the page, under the first screen
  // (index.html, #landing), for the visitor and for the search engine that renders this page.
  document.documentElement.classList.toggle('first-visit', to.name === 'setup' && !useSites().sites.length)
  const title = (to.meta.title as string) ?? ''
  const whole = typeof to.query.q === 'string' && to.query.q ? to.query.q : ''
  // (A tab's title, a history entry: a very long query is cut.)
  const q = whole.length > 80 ? whole.slice(0, 77) + '…' : whole
  document.title = q ? `${q} · ${BRAND}` : to.name === 'home' || to.name === 'setup' ? FULL_TITLE : title ? `${title} · ${BRAND}` : BRAND
})

/** Warm the lazily loaded views once the first screen is up. */
export function prefetchViews() {
  const run = () => Object.values(lazy).forEach((f) => f().catch(() => {}))
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: object) => void }).requestIdleCallback
  if (ric) ric(run, { timeout: 4000 })
  else setTimeout(run, 2000)
}
