/* A list of posts that grows on demand. Searches sorted by id page with a cursor ("below this id"),
   which is cheap and has no depth limit; other sorts use page numbers. Feeds are kept for a while
   so going back to a search shows it at once, where it was. */
import { ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import type { Post } from '@/api/types'
import { getFavorites, searchPosts } from '@/api/endpoints'
import { useSites } from '@/stores/sites'
import { hasOrder, tokenize, withDefaultFilter } from '@/query/syntax'
import { Priority, rememberMediaHost } from '@/api/client'

export interface LoadResult {
  posts: Post[]
  done?: boolean
}

/** priority: Background for a page asked for ahead of need (Settings › Preloading), so the person's
    own requests pass it in the client's queue; User otherwise. */
export type Loader = (ctx: { page: number; lastId: number | null; signal: AbortSignal; first: boolean; priority: Priority }) => Promise<LoadResult>

export interface Feed {
  key: string
  title: string
  posts: ShallowRef<Post[]>
  loading: Ref<boolean>
  done: Ref<boolean>
  error: Ref<string | null>
  /** When the first page arrived. */
  loadedAt: Ref<number>
  /** ahead: the page is not needed yet, only loaded early (see Loader). */
  loadMore: (ahead?: boolean) => Promise<void>
  reload: () => Promise<void>
  /** Add posts in front (new uploads since loading). */
  prepend: (posts: Post[]) => void
  abort: () => void
  /** A list of one's own (favourites, collections, history): posts marked "not interested" stay. */
  personal?: boolean
  /** How many posts the whole list holds, when its source says so (a pool's pages): the viewer counts
      against it rather than against what is loaded so far. */
  total?: number
}

/** A page asked for ahead leaves at least this long after the list's previous one: the pace the sites
    ask clients to keep up for long (one request a second; their hard limit, two, is the client's). */
const AHEAD_GAP_MS = 1000

export function createFeed(key: string, title: string, loader: Loader): Feed {
  const posts = shallowRef<Post[]>([])
  const loading = ref(false)
  const done = ref(false)
  const error = ref<string | null>(null)
  const loadedAt = ref(0)
  let page = 1
  let ctrl: AbortController | null = null
  let current: Promise<void> | null = null
  /** Bumped by abort(): a load from before it neither writes its result nor ends the next load. */
  let gen = 0
  const ids = new Set<number>()
  let lastStart = -Infinity

  async function loadMore(ahead = false): Promise<void> {
    if (done.value) return
    if (current) return current
    loading.value = true
    error.value = null
    const my = (ctrl = new AbortController())
    const g = gen
    const first = posts.value.length === 0
    const lastId = posts.value.length ? posts.value[posts.value.length - 1].id : null
    current = (async () => {
      try {
        const early = ahead && !first
        const gap = lastStart + AHEAD_GAP_MS - performance.now()
        if (early && gap > 0) {
          await new Promise((r) => setTimeout(r, gap))
          if (g !== gen) return
        }
        lastStart = performance.now()
        const r = await loader({ page, lastId, signal: my.signal, first, priority: early ? Priority.Background : Priority.User })
        if (g !== gen) return // aborted (a reload) meanwhile: its result belongs to nothing now
        const fresh = r.posts.filter((p) => (ids.has(p.id) ? false : (ids.add(p.id), true)))
        if (fresh.length) {
          posts.value = [...posts.value, ...fresh]
          rememberMediaHost(fresh[0].previewUrl ?? fresh[0].fileUrl)
        }
        page++
        if (first) loadedAt.value = Date.now()
        // A loader that filters (Flash in a pool chunk) may return nothing yet have more: trust `done`.
        if (r.done ?? r.posts.length === 0) done.value = true
      } catch (e) {
        if (g === gen && (e as Error).name !== 'AbortError') error.value = (e as Error).message
      } finally {
        if (g === gen) {
          loading.value = false
          current = null
        }
      }
    })()
    return current
  }

  async function reload() {
    abort()
    posts.value = []
    ids.clear()
    page = 1
    done.value = false
    error.value = null
    await loadMore()
  }

  function prepend(list: Post[]) {
    const fresh = list.filter((p) => (ids.has(p.id) ? false : (ids.add(p.id), true)))
    if (fresh.length) posts.value = [...fresh, ...posts.value]
  }

  function abort() {
    gen++
    ctrl?.abort()
    ctrl = null
    current = null
    loading.value = false
  }

  return { key, title, posts, loading, done, error, loadedAt, loadMore, reload, prepend, abort }
}

const FIRST_PAGE = 40
const MAX_PAGE_NUMBER = 750

export interface SearchOptions {
  pageSize: number
  defaultFilter: string
  blockFlash: boolean
}

/** Does the query itself ask for Flash files? Then it wins over the block. */
function asksForFlash(q: string): boolean {
  return tokenize(q).some((t) => t.kind === 'meta' && t.name === 'type' && t.value.toLowerCase() === 'swf' && t.prefix !== '-')
}

/** The query sent to the site: the person's terms, the default filter and the Flash block. */
export function effectiveQuery(query: string, opts: Pick<SearchOptions, 'defaultFilter' | 'blockFlash'>): string {
  const full = withDefaultFilter(query, opts.defaultFilter)
  return opts.blockFlash && !asksForFlash(full) ? withDefaultFilter(full, '-type:swf') : full
}

/** Lists that cannot be filtered by the site (popular, pools, favourites) drop Flash posts here. */
export function withoutFlash(posts: Post[], block: boolean): Post[] {
  return block ? posts.filter((p) => p.kind !== 'flash') : posts
}

/** A feed for a search query. */
export function searchFeed(query: string, opts: SearchOptions): Feed {
  // One's own favourites alone (the title bar's Favourites when signed in): in the order favourited,
  // as the site lists them, rather than a fav:name search's order by post.
  const me = useSites().hasAccount ? useSites().active?.username?.toLowerCase() : ''
  if (me && query.trim().toLowerCase() === `fav:${me}`) {
    return createFeed(`favorites:${me}`, query, async ({ page, signal, priority }) => {
      // (Numbered pages of one size, the first one too: with a smaller first page, the next page
      // number would skip some.)
      const posts = await getFavorites({ limit: opts.pageSize, page, signal, priority })
      return { posts, done: posts.length < opts.pageSize || page >= MAX_PAGE_NUMBER }
    })
  }
  const full = effectiveQuery(query, opts)
  const order = hasOrder(full)
  const cursorMode = !order || order === 'id' || order === 'id_desc'
  return createFeed(`search:${full}`, query, async ({ page, lastId, signal, first, priority }) => {
    if (cursorMode) {
      // A small first page paints sooner; later pages are larger to need fewer requests.
      const limit = first ? Math.min(FIRST_PAGE, opts.pageSize) : Math.max(opts.pageSize, 75)
      const posts = await searchPosts(full, { limit, page: lastId ? `b${lastId}` : undefined, signal, priority })
      return { posts, done: posts.length < limit }
    }
    const posts = await searchPosts(full, { limit: opts.pageSize, page, signal, priority })
    return { posts, done: posts.length < opts.pageSize || page >= MAX_PAGE_NUMBER }
  })
}

/** Several searches as one list, newest first: the Following stream past what one search takes. Each
    page asks every search for its posts below the cursor. Above the highest of the lowest ids of the
    searches that filled their page, nothing can be missing: that part is the page, and the rest is
    asked for again with the next one. Searches sorted otherwise than by id do not belong here. */
export function mergedFeed(queries: string[], opts: SearchOptions): Feed {
  const full = queries.map((q) => effectiveQuery(q, opts))
  return createFeed(`merged:${full.join(' | ')}`, queries.join(' | '), async ({ lastId, signal, first, priority }) => {
    const limit = first ? Math.min(FIRST_PAGE, opts.pageSize) : Math.max(opts.pageSize, 75)
    const pages = await Promise.all(full.map((q) => searchPosts(q, { limit, page: lastId ? `b${lastId}` : undefined, signal, priority })))
    const byId = new Map<number, Post>()
    let floor = 0
    for (const list of pages) {
      for (const p of list) byId.set(p.id, p)
      if (list.length >= limit) floor = Math.max(floor, Math.min(...list.map((p) => p.id)))
    }
    const posts = [...byId.values()].filter((p) => p.id >= floor).sort((a, b) => b.id - a.id)
    return { posts, done: floor === 0 }
  })
}

/** A list kept elsewhere (favourites, history, a sorted pool) exposed as a feed that follows it. */
export function refFeed(key: string, title: string, source: Ref<Post[]>): Feed & { stop: () => void } {
  const f = createFeed(key, title, async () => ({ posts: [], done: true }))
  f.done.value = true
  const stop = watch(source, (v) => (f.posts.value = v), { immediate: true })
  return { ...f, stop, personal: true }
}

// ---- cache of recent feeds ----
const cache = new Map<string, Feed>()
const CACHE_MAX = 8

export function cachedFeed(key: string, make: () => Feed): Feed {
  const hit = cache.get(key)
  if (hit && !hit.error.value) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const f = make()
  cache.set(key, f)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.get(oldest)?.abort()
    cache.delete(oldest)
  }
  return f
}

export function dropFeedCache() {
  cache.forEach((f) => f.abort())
  cache.clear()
}
