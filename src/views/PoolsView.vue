<script setup lang="ts">
/* Pools: Browse searches the site's pools; Library lists the pools saved in this browser (the site's
   API cannot favourite a pool). Three layouts: a compact list, a list with large covers, a grid. */
import { vDecode } from '@/directives/decode'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRefresh } from '@/services/refresh'
import Segmented from '@/components/Segmented.vue'
import StatePanel from '@/components/StatePanel.vue'
import Icon from '@/components/Icon.vue'
import { searchPools, searchPosts } from '@/api/endpoints'
import { Priority } from '@/api/client'
import type { Pool, Post } from '@/api/types'
import { prettyTag } from '@/query/syntax'
import { useBlacklist } from '@/stores/blacklist'
import { usePoolLibrary, type SavedPool } from '@/stores/poolLibrary'
import { usePoolProgress } from '@/stores/poolProgress'
import { useSettings, type PoolLayout } from '@/stores/settings'
import { useSites } from '@/stores/sites'
import { looksExplicit } from '@/utils/sfwWords'
import { useUi } from '@/stores/ui'
import { relativeTime } from '@/utils/format'
import { dtextExcerpt } from '@/utils/dtext'
import { openInNewTab, openMenu } from '@/services/contextMenu'
import { copyText } from '@/composables/dom'

const route = useRoute()
const router = useRouter()
const blacklist = useBlacklist()
const library = usePoolLibrary()
const progress = usePoolProgress()
const settings = useSettings()
const sites = useSites()
const ui = useUi()

const tab = computed({
  get: () => settings.s.poolsTab,
  set: (v: 'browse' | 'library') => (settings.s.poolsTab = v),
})
const layout = computed({
  get: () => settings.s.poolLayout,
  set: (v: PoolLayout) => (settings.s.poolLayout = v),
})
const name = ref(typeof route.query.name === 'string' ? route.query.name : '')
const category = ref(typeof route.query.category === 'string' ? route.query.category : '')
const order = ref(typeof route.query.order === 'string' ? route.query.order : 'updated_at')
const libOrder = ref<'saved' | 'new' | 'updated' | 'name'>('saved')

const covers = shallowRef(new Map<number, Post>())

// ---------- browse: the site's pools ----------
const pools = shallowRef<Pool[]>([])
const page = ref(1)
const loading = ref(false)
const done = ref(false)
const error = ref<string | null>(null)
let ctrl: AbortController | null = null
const PER = 40

async function load(reset: boolean) {
  ctrl?.abort()
  ctrl = new AbortController()
  if (reset) {
    page.value = 1
    pools.value = []
    done.value = false
  }
  loading.value = true
  error.value = null
  try {
    const list = await searchPools({ name: name.value, category: category.value || undefined, order: order.value, page: page.value, limit: PER, signal: ctrl.signal })
    pools.value = reset ? list : [...pools.value, ...list]
    done.value = list.length < PER
    page.value++
    library.refresh(list)
    void loadCovers(list.flatMap(coverIds))
  } catch (e) {
    if ((e as Error).name !== 'AbortError') error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

/** The first post of each pool, fetched in one request, as its cover. */
async function loadCovers(ids: (number | null | undefined)[]) {
  const want = [...new Set(ids.filter((x): x is number => !!x && !covers.value.has(x)))]
  if (!want.length) return
  try {
    for (let i = 0; i < want.length; i += 100) {
      const chunk = want.slice(i, i + 100)
      const posts = await searchPosts(`id:${chunk.join(',')}`, { limit: chunk.length, priority: Priority.Background })
      const m = new Map(covers.value)
      for (const p of posts) m.set(p.id, p)
      covers.value = m
    }
  } catch {
    /* covers are a nicety */
  }
}

// ---------- library: the pools saved here ----------
/** Fresh copies from the site, by id (the saved entries show until they arrive, or offline). */
const fetched = shallowRef(new Map<number, Pool>())
const libLoading = ref(false)
const libError = ref(false)

async function loadLibrary() {
  const ids = library.list.map((p) => p.id)
  void loadCovers(library.list.map((p) => p.coverId))
  if (!ids.length) return
  libLoading.value = true
  libError.value = false
  try {
    const got: Pool[] = []
    for (let i = 0; i < ids.length; i += 100) got.push(...(await searchPools({ ids: ids.slice(i, i + 100), limit: 100 })))
    library.refresh(got)
    fetched.value = new Map(got.map((p) => [p.id, p]))
    void loadCovers(got.flatMap(coverIds))
  } catch {
    libError.value = true
  } finally {
    libLoading.value = false
  }
}

function asPool(s: SavedPool): Pool {
  return (
    fetched.value.get(s.id) ?? {
      id: s.id,
      name: s.name,
      description: '',
      category: s.category,
      isActive: s.isActive,
      postIds: s.coverId ? [s.coverId] : [],
      postCount: s.postCount,
      createdAt: '',
      updatedAt: s.updatedAt,
      creatorName: null,
    }
  )
}

const libraryRows = computed<Pool[]>(() => {
  const q = name.value.trim().toLowerCase().replace(/\s+/g, '_')
  // (On e926, not the pools of a library shared with e621 whose names read as adult: utils/sfwWords.)
  const list = library.list.filter((s) => (!category.value || s.category === category.value) && (!q || s.name.toLowerCase().includes(q)) && !(sites.sfw && looksExplicit(s.name)))
  const sorted = [...list] // saved order: most recently saved first
  if (libOrder.value === 'new') sorted.sort((a, b) => library.newPages(b.id) - library.newPages(a.id))
  else if (libOrder.value === 'updated') sorted.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  else if (libOrder.value === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
  return sorted.map(asPool)
})

// (On the safe board, public pools named or described in adult words are left out: utils/sfwWords.)
const rows = computed(() =>
  tab.value === 'library' ? libraryRows.value : sites.sfw ? pools.value.filter((p) => !looksExplicit(p.name, p.description)) : pools.value,
)

function toggleSave(p: Pool) {
  const on = library.toggle(p)
  ui.toast(on ? `Saved to the library: ${prettyTag(p.name)}` : `Removed from the library: ${prettyTag(p.name)}`, { tone: on ? 'ok' : undefined })
}

/** Right-click (or long press) on a pool. */
function onPoolMenu(e: MouseEvent, p: Pool) {
  const href = (e.currentTarget as HTMLElement).querySelector<HTMLAnchorElement>('a.pool')?.href ?? ''
  const saved = library.isSaved(p.id)
  const siteUrl = sites.active ? `${sites.active.url}/pools/${p.id}` : null
  openMenu(
    e,
    [
      { label: 'Open', icon: 'eye', href: href || undefined, run: () => void router.push(`/pools/${p.id}`) },
      { label: 'Open in a new tab', icon: 'external', disabled: !href, run: () => openInNewTab(href) },
      'sep',
      { label: saved ? 'Remove from the library' : 'Save to the library', icon: saved ? 'bookmark-on' : 'bookmark', run: () => toggleSave(p) },
      'sep',
      { label: 'Copy link to the pool', icon: 'link', disabled: !siteUrl, run: async () => ui.toast((await copyText(siteUrl!)) ? 'Link copied' : 'Could not copy the link') },
      { label: sites.active ? `Open on ${sites.active.name}` : 'Open on the site', icon: 'external', disabled: !siteUrl, run: () => window.open(siteUrl!, '_blank', 'noopener,noreferrer') },
    ],
    prettyTag(p.name),
  )
}

/* A pool's cover is its first post, or the next one when the site does not show the first (posts
   it withholds, from guests or from this site entirely): the first few are asked for together. */
const COVER_TRIES = 4
function coverIds(p: Pool): number[] {
  return p.postIds.slice(0, COVER_TRIES)
}
function coverPost(p: Pool): Post | undefined {
  for (const id of coverIds(p)) {
    const c = covers.value.get(id)
    if (c) return c
  }
  return undefined
}
/** Grid cards are large: they take the sample; the lists make do with the small preview. */
function coverUrl(p: Pool): string | null {
  const c = coverPost(p)
  if (!c) return null
  return layout.value === 'grid' ? (c.sampleUrl ?? c.previewUrl) : (c.previewUrl ?? c.sampleUrl)
}

// ---------- hover preview: the first pages of a pool (lists only) ----------
const PEEK_PAGES = 5
const PEEK_DELAY = 220
type Page = { n: number; post: Post }
/** Pool id → its first pages in pool order (a promise, so a hover that comes back reuses the request). */
const peekCache = new Map<number, Promise<Page[]>>()
const peek = shallowRef<{ id: number; pages: Page[]; up: boolean } | null>(null)
let peekTimer: number | null = null
let peekFor: number | null = null

function firstPages(pool: Pool): Promise<Page[]> {
  let pending = peekCache.get(pool.id)
  if (!pending) {
    const ids = pool.postIds.slice(0, PEEK_PAGES)
    pending = (ids.length ? searchPosts(`id:${ids.join(',')}`, { limit: ids.length, priority: Priority.Viewer }) : Promise.resolve([])).then((posts) => {
      const byId = new Map(posts.map((p) => [p.id, p]))
      return ids.flatMap((id, i) => {
        const post = byId.get(id)
        return post && (post.previewUrl || post.sampleUrl) ? [{ n: i + 1, post }] : []
      })
    })
    pending.catch(() => peekCache.delete(pool.id))
    peekCache.set(pool.id, pending)
  }
  return pending
}

function peekStart(pool: Pool, e: PointerEvent) {
  // Grid cards already show a large cover; saved entries waiting for the site lack their page list.
  if (e.pointerType !== 'mouse' || layout.value === 'grid' || pool.postIds.length < 2) return
  peekFor = pool.id
  const pages = firstPages(pool) // starts the request now, shows it after the pause
  // Open towards the larger side of the window, so the preview stays on screen.
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const up = box.top + box.height / 2 > window.innerHeight / 2
  if (peekTimer != null) clearTimeout(peekTimer)
  peekTimer = window.setTimeout(async () => {
    try {
      const list = await pages
      if (peekFor === pool.id && list.length) peek.value = { id: pool.id, pages: list, up }
    } catch {
      /* no preview, the link still works */
    }
  }, PEEK_DELAY)
}

function peekEnd() {
  peekFor = null
  if (peekTimer != null) clearTimeout(peekTimer)
  peekTimer = null
  peek.value = null
}
onBeforeUnmount(peekEnd)

// ---------- loading ----------
let timer: number | null = null
watch([name, category, order], () => {
  if (tab.value !== 'browse') return // the library filters what it already has
  if (timer != null) clearTimeout(timer)
  timer = window.setTimeout(() => {
    router.replace({ path: '/pools', query: { name: name.value || undefined, category: category.value || undefined, order: order.value !== 'updated_at' ? order.value : undefined } })
    void load(true)
  }, 250)
})
// Left within the 250 ms: the timer must not bring the person back to the pools.
onBeforeUnmount(() => {
  if (timer != null) clearTimeout(timer)
})
watch(tab, (t) => {
  peekEnd()
  if (t === 'library') void loadLibrary()
  else void load(true)
})
watch(
  () => sites.scope,
  () => {
    covers.value = new Map()
    fetched.value = new Map()
    if (tab.value === 'library') void loadLibrary()
    else void load(true)
  },
)
onMounted(() => (tab.value === 'library' ? loadLibrary() : load(true)))

const tabs = computed(() => [
  { value: 'browse' as const, label: 'Browse', title: "The site's pools" },
  { value: 'library' as const, label: library.count ? `Library ${library.count}` : 'Library', title: 'Pools saved in this browser' },
])
const cats = [
  { value: '', label: 'All' },
  { value: 'series', label: 'Series' },
  { value: 'collection', label: 'Collections' },
]
const layouts: { value: PoolLayout; label: string; icon: string; title: string }[] = [
  { value: 'list', label: 'List', icon: 'list', title: 'List: small covers' },
  { value: 'large', label: 'Large', icon: 'rows', title: 'List with large covers' },
  { value: 'grid', label: 'Grid', icon: 'grid', title: 'Grid of large covers' },
]
// Pull down at the top: the list again (the site's pools, or the library's from the site).
useRefresh(() => (tab.value === 'browse' ? load(true) : loadLibrary()))
</script>

<template>
  <div class="page-narrow" :class="'lay-' + layout">
    <div class="page-head flat">
      <h1 v-decode="'// Pools'"></h1>
      <Segmented v-model="tab" :options="tabs" label="Pools" />
      <input
        v-model="name"
        class="rv-input q"
        type="search"
        :placeholder="tab === 'library' ? 'Filter the library' : 'Find a pool by name'"
        :aria-label="tab === 'library' ? 'Filter the library by name' : 'Pool name'"
      />
      <Segmented v-model="category" :options="cats" label="Category" />
      <select v-if="tab === 'browse'" v-model="order" class="rv-select ord" aria-label="Sort">
        <option value="updated_at">Recently updated</option>
        <option value="created_at">Newest</option>
        <option value="post_count">Most posts</option>
        <option value="name">Name</option>
      </select>
      <select v-else v-model="libOrder" class="rv-select ord" aria-label="Sort the library">
        <option value="saved">Recently saved</option>
        <option value="new">New pages first</option>
        <option value="updated">Recently updated</option>
        <option value="name">Name</option>
      </select>
      <span class="grow"></span>
      <Segmented v-model="layout" :options="layouts" label="Layout" />
    </div>

    <p v-if="tab === 'library' && libError && rows.length" class="rv-hint note">The site did not answer: showing the saved copies.</p>

    <div v-if="rows.length" class="pools" :class="'lay-' + layout">
      <div v-for="p in rows" :key="p.id" class="item" @contextmenu="onPoolMenu($event, p)">
        <RouterLink :to="`/pools/${p.id}`" class="pool">
          <span class="cover" @pointerenter="peekStart(p, $event)" @pointerleave="peekEnd">
            <img v-if="coverUrl(p)" :src="coverUrl(p)!" :class="{ masked: blacklist.match(coverPost(p)!) }" alt="" loading="lazy" decoding="async" />
            <!-- None of its first posts shown by the site (or not looked up yet): a placeholder, not a hole. -->
            <Icon v-else name="pool" class="nocover" :size="18" aria-hidden="true" />
            <span v-if="library.newPages(p.id)" class="fresh tabular" :title="`${library.newPages(p.id)} pages since you last opened it`">+{{ library.newPages(p.id) }}</span>
          </span>
          <span v-if="peek?.id === p.id" class="peek rv-brackets" :class="{ up: peek.up }" aria-hidden="true">
            <span class="peek-head rv-label">
              First pages<span class="tabular">{{ peek.pages[peek.pages.length - 1].n }} / {{ p.postCount }}</span>
            </span>
            <span class="peek-pages">
              <span v-for="pg in peek.pages" :key="pg.post.id" class="peek-page" :class="{ masked: blacklist.match(pg.post) }">
                <img :src="(pg.post.previewUrl ?? pg.post.sampleUrl)!" alt="" decoding="async" :style="{ aspectRatio: `${pg.post.width || 1} / ${pg.post.height || 1}` }" />
                <span class="peek-n tabular">{{ pg.n }}</span>
              </span>
            </span>
          </span>
          <span class="meta">
            <span class="pname">{{ prettyTag(p.name) }}</span>
            <span class="readout">
              <template v-if="layout !== 'grid'">{{ p.category }} // </template>{{ p.postCount }} posts<template v-if="p.updatedAt"> // {{ layout === 'grid' ? '' : 'updated ' }}{{ relativeTime(p.updatedAt) }}</template><template v-if="!p.isActive"> // ended</template><template v-if="progress.get(p.id)"> // read {{ progress.get(p.id)!.page }}/{{ p.postCount }}</template>
            </span>
            <span v-if="p.description && layout !== 'grid'" class="desc">{{ dtextExcerpt(p.description, layout === 'large' ? 300 : 160) }}</span>
          </span>
          <Icon v-if="layout !== 'grid'" name="chevron-right" class="go" />
        </RouterLink>
        <button
          class="rv-icon-btn save"
          :class="{ 'is-on': library.isSaved(p.id) }"
          type="button"
          :aria-pressed="library.isSaved(p.id)"
          :title="library.isSaved(p.id) ? 'Remove from the library' : 'Save to the library'"
          @click="toggleSave(p)"
        >
          <Icon :name="library.isSaved(p.id) ? 'bookmark-on' : 'bookmark'" />
        </button>
      </div>
    </div>

    <template v-if="tab === 'library'">
      <div v-if="!library.count" class="state">
        <StatePanel label="Library // empty" message="Save a pool with its bookmark, here or on the pool's page, to keep it in this browser. New pages show as +N." />
      </div>
      <div v-else-if="!rows.length" class="state"><StatePanel label="No saved pool" :message="name ? `No saved pool name contains « ${name} ».` : 'No saved pool in this category.'" /></div>
    </template>
    <template v-else>
      <div v-if="error" class="state">
        <StatePanel label="Pools failed" :message="error" alert>
          <template #actions><button class="rv-btn rv-btn--primary" type="button" @click="load(!pools.length)">Retry</button></template>
        </StatePanel>
      </div>
      <div v-else-if="loading && !pools.length" class="state"><StatePanel label="Loading" loading /></div>
      <div v-else-if="done && !pools.length" class="state"><StatePanel label="No pools" :message="name ? `No pool name contains « ${name} ».` : 'No pools.'" /></div>
      <div v-else-if="!done" class="more">
        <button class="rv-btn" type="button" :disabled="loading" @click="load(false)">{{ loading ? 'Loading…' : 'More pools' }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.flat {
  position: static;
}
.q {
  width: 240px;
  height: 26px;
}
.ord {
  width: auto;
  height: 26px;
}
.note {
  margin: 0 0 10px;
}

/* ---------- lists ---------- */
.pools {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  border: 1px solid var(--line-2);
}
.item {
  position: relative;
  border-bottom: 1px solid var(--line);
}
.item:last-child {
  border-bottom: 0;
}
.pool {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 12px 8px 8px;
  padding-right: 84px; /* room for the save button and the chevron */
  color: var(--text);
  text-decoration: none;
}
.pool:hover {
  background: var(--hover);
}
.cover {
  position: relative;
  width: 64px;
  height: 64px;
  flex: none;
  background: var(--panel);
  overflow: hidden;
}
.cover .nocover {
  position: absolute;
  inset: 0;
  margin: auto;
  color: var(--text-3);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover img.masked {
  visibility: hidden;
}
.fresh {
  position: absolute;
  right: 0;
  bottom: 0;
  padding: 1px 5px;
  font-size: 0.625rem;
  color: var(--bg);
  background: var(--text);
}
.meta {
  display: grid;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.pname {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.readout {
  font-size: 0.625rem;
}
.desc {
  color: var(--text-3);
  font-size: 0.6875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.go {
  position: absolute;
  right: 12px;
  color: var(--text-3);
}
.save {
  position: absolute;
  right: 36px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-3);
}
.save.is-on {
  color: var(--text);
}

/* Large covers: a bigger picture and two lines of description. */
.lay-large .cover {
  width: 120px;
  height: 120px;
}
.lay-large .pname {
  font-size: 0.8125rem;
}
.lay-large .desc {
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.45;
}

/* ---------- grid: cards with a large cover ---------- */
.pools.lay-grid {
  grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
  gap: 14px;
  border: 0;
}
.lay-grid .item {
  border-bottom: 0;
}
.lay-grid .pool {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 0 0 8px;
}
.lay-grid .pool:hover {
  background: none;
}
.lay-grid .cover {
  width: 100%;
  height: auto;
  aspect-ratio: 3 / 4;
}
.lay-grid .pool:hover .cover,
.lay-grid .pool:focus-visible .cover {
  outline: 1px solid var(--text);
  outline-offset: -1px;
}
.lay-grid .pname {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.35;
}
.lay-grid .fresh {
  right: 0;
  bottom: 0;
  padding: 2px 6px;
  font-size: 0.6875rem;
}
.lay-grid .save {
  top: 6px;
  right: 6px;
  transform: none;
  background: var(--scrim-62);
  color: var(--text-2);
}
.lay-grid .save.is-on {
  color: var(--text);
}

/* First pages, shown beside the cover while the mouse rests on it (lists). */
.peek {
  position: absolute;
  left: 82px;
  top: 4px;
  z-index: 20;
  display: grid;
  gap: 8px;
  max-width: calc(100% - 96px);
  padding: 10px 12px 12px;
  background-color: var(--bg);
  border: 1px solid var(--line-2);
  box-shadow: 0 10px 28px var(--scrim-62);
  pointer-events: none;
  animation: peek-in 0.12s ease-out;
}
.lay-large .peek {
  left: 138px;
  max-width: calc(100% - 152px);
}
.peek.up {
  top: auto;
  bottom: 4px;
}
@keyframes peek-in {
  from {
    opacity: 0;
  }
}
.peek-head {
  display: flex;
  justify-content: space-between;
  gap: 24px;
}
.peek-pages {
  display: flex;
  gap: 6px;
  overflow: hidden;
}
.peek-page {
  position: relative;
  flex: none;
  height: 150px;
  background: var(--panel);
  overflow: hidden;
}
.peek-page img {
  display: block;
  height: 100%;
  width: auto;
  max-width: 220px;
  object-fit: cover;
}
.peek-page.masked img {
  visibility: hidden;
}
.peek-n {
  position: absolute;
  left: 0;
  bottom: 0;
  padding: 1px 5px;
  font-size: 0.625rem;
  color: var(--text);
  background: var(--scrim-75);
}

.more {
  display: grid;
  place-items: center;
  padding: 18px 0;
}
@media (max-width: 640px) {
  .q {
    width: 100%;
  }
  .lay-large .cover {
    width: 92px;
    height: 92px;
  }
  .pools.lay-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }
}
</style>
