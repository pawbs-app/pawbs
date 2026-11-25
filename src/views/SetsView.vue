<script setup lang="ts">
/* Sets and collections. Collections are lists kept in this browser, made without an account. Sets
   are the site's: browse the public ones by name, keep any in the library (this browser, no account
   needed), and with an account, see and make your own. */
import { vDecode } from '@/directives/decode'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRefresh } from '@/services/refresh'
import Icon from '@/components/Icon.vue'
import Segmented from '@/components/Segmented.vue'
import StatePanel from '@/components/StatePanel.vue'
import SetEditDialog from '@/components/SetEditDialog.vue'
import CollectionEditDialog from '@/components/CollectionEditDialog.vue'
import { useCollections, type Collection } from '@/stores/collections'
import { useSettings } from '@/stores/settings'
import { searchPosts, searchSets, type SetOrder } from '@/api/endpoints'
import { Priority } from '@/api/client'
import type { Post, PostSet } from '@/api/types'
import { useSites } from '@/stores/sites'
import { useSetLibrary, type SavedSet } from '@/stores/setLibrary'
import { useMySets } from '@/stores/mySets'
import { useBlacklist } from '@/stores/blacklist'
import { useUi } from '@/stores/ui'
import { rememberSets } from '@/services/setCache'
import { openInNewTab, openMenu } from '@/services/contextMenu'
import { relativeTime } from '@/utils/format'
import { dtextExcerpt } from '@/utils/dtext'
import { looksExplicit } from '@/utils/sfwWords'

type Tab = 'collections' | 'browse' | 'library' | 'mine'
interface Row {
  id: number
  name: string
  shortname: string
  postCount: number
  coverIds: number[]
  isPublic: boolean
  updatedAt: string
  description?: string
}

const route = useRoute()
const router = useRouter()
const sites = useSites()
const library = useSetLibrary()
const mine = useMySets()
const blacklist = useBlacklist()
const ui = useUi()
const settings = useSettings()
const collections = useCollections()

const tabs = [
  { value: 'collections', label: 'Collections', title: 'Lists kept in this browser, no account needed' },
  { value: 'browse', label: 'Browse', title: 'Public sets on the site' },
  { value: 'library', label: 'Library', title: 'Sets kept in this browser' },
  { value: 'mine', label: 'Yours', title: 'The account’s own sets' },
]
// Opened without a tab: one's own lists, the tab of them used last (collections to begin with).
// Public sets are a tab away, never where the page opens.
const ownTab = (): Tab => (settings.s.setsTab && settings.s.setsTab !== 'browse' ? settings.s.setsTab : 'collections')
const tabOf = (q: unknown): Tab => (['collections', 'browse', 'library', 'mine'] as const).find((t) => t === q) ?? ownTab()
const tab = ref<Tab>(tabOf(route.query.tab))
watch(tab, (t) => {
  if (t !== 'browse') settings.s.setsTab = t
  if (route.query.tab !== t) void router.replace({ path: '/sets', query: { ...route.query, tab: t } })
})
// A link to another tab of this page (/sets?tab=mine after deleting a set, say).
watch(
  () => route.query.tab,
  (q) => {
    if (route.name === 'sets') tab.value = tabOf(q)
  },
)

/** Covers loaded so far, by post (declared before the tab watcher below starts loading them). */
const covers = shallowRef(new Map<number, Post>())
/** The first posts tried for a cover: on a site showing only part of the posts, the first is often hidden. */
const COVER_TRIES = 8
const asRow = (s: PostSet): Row => ({ ...s, coverIds: s.postIds.slice(0, COVER_TRIES) })
const fromSaved = (s: SavedSet): Row => ({ ...s })

// ---------- browse ----------
const name = ref(typeof route.query.name === 'string' ? route.query.name : '')
const order = ref<SetOrder>('updated_at')
const found = shallowRef<PostSet[]>([])
const page = ref(1)
const done = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const PER = 24
let ctrl: AbortController | null = null

async function browse(reset: boolean) {
  ctrl?.abort()
  const my = (ctrl = new AbortController())
  if (reset) {
    page.value = 1
    found.value = []
    done.value = false
  }
  loading.value = true
  error.value = null
  try {
    const list = await searchSets({ name: name.value, order: order.value, page: page.value, limit: PER, signal: my.signal })
    if (my !== ctrl) return
    rememberSets(list)
    library.refresh(list)
    found.value = reset ? list : [...found.value, ...list]
    done.value = list.length < PER
    page.value++
    void loadCovers(list.map(asRow))
  } catch (e) {
    if (my === ctrl && (e as Error).name !== 'AbortError') error.value = (e as Error).message
  } finally {
    if (my === ctrl) loading.value = false
  }
}
let timer: number | null = null
watch([name, order], () => {
  if (timer != null) clearTimeout(timer)
  timer = window.setTimeout(() => void browse(true), 300)
})
onBeforeUnmount(() => {
  if (timer != null) clearTimeout(timer)
  ctrl?.abort()
})

// ---------- library ----------
const libFilter = ref('')
async function refreshLibrary() {
  const ids = library.list.map((s) => s.id)
  void loadCovers(library.list.map(fromSaved))
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const got = await searchSets({ ids: ids.slice(i, i + 50), limit: 50 })
      rememberSets(got)
      library.refresh(got)
    }
    void loadCovers(library.list.map(fromSaved))
  } catch {
    /* the saved copies show */
  }
}

// ---------- collections (this browser) ----------
const collFilter = ref('')
const collSort = ref<'updated' | 'name' | 'size'>('updated')
const makingColl = ref(false)
const shownColls = computed(() => {
  const f = collFilter.value.trim().toLowerCase()
  const out = collections.list.filter((c) => !f || c.name.toLowerCase().includes(f) || c.description.toLowerCase().includes(f))
  if (collSort.value === 'name') return [...out].sort((a, b) => a.name.localeCompare(b.name))
  if (collSort.value === 'size') return [...out].sort((a, b) => b.items.length - a.items.length)
  return [...out].sort((a, b) => b.updatedAt - a.updatedAt)
})
/** Up to four pictures for a collection's cover (the first ones the blacklist lets through). */
function collCovers(c: Collection): string[] {
  const out: string[] = []
  for (const p of collections.postsOf(c)) {
    if (out.length >= 4) break
    const u = p.previewUrl ?? p.sampleUrl
    if (u && !blacklist.match(p)) out.push(u)
  }
  return out
}
const editingColl = ref<Collection | null>(null)
function deleteColl(c: Collection) {
  const gone = collections.remove(c.id)
  if (gone) ui.toast(`Collection ${c.name} deleted`, { action: { label: 'Undo', run: () => collections.restore(gone.c, gone.at) } })
}
function onCollMenu(e: MouseEvent, c: Collection) {
  const href = router.resolve(`/collections/${c.id}`).href
  openMenu(
    e,
    [
      { label: 'Open', icon: 'chevron-right', href, run: () => void router.push(`/collections/${c.id}`) },
      { label: 'Open in a new tab', icon: 'external', run: () => openInNewTab(href) },
      'sep',
      { label: 'Edit…', icon: 'edit', run: () => void (editingColl.value = c) },
      { label: 'Delete', icon: 'trash', danger: true, run: () => deleteColl(c) },
    ],
    c.name,
  )
}
function onCollMade(c: Collection) {
  makingColl.value = false
  void router.push(`/collections/${c.id}`)
}

// ---------- yours ----------
const editing = ref(false)
function onCreated(s: PostSet) {
  editing.value = false
  void router.push(`/sets/${s.id}`)
}

watch(
  tab,
  (t) => {
    if (t === 'browse' && !found.value.length) void browse(true)
    else if (t === 'library') void refreshLibrary()
    else if (t === 'mine')
      void mine.load().then(() => {
        rememberSets(mine.sets)
        return loadCovers(mine.sets.map(asRow))
      })
  },
  { immediate: true },
)
watch(
  () => sites.scope,
  () => {
    covers.value = new Map()
    if (tab.value === 'browse') void browse(true)
  },
)

const rows = computed<Row[]>(() => {
  if (tab.value === 'collections') return []
  // (On the safe board, public sets named or described in adult words are left out: utils/sfwWords.)
  if (tab.value === 'browse') return (sites.sfw ? found.value.filter((s) => !looksExplicit(s.name, s.shortname, s.description)) : found.value).map(asRow)
  if (tab.value === 'mine') return mine.sets.map(asRow)
  const f = libFilter.value.trim().toLowerCase()
  // (On e926, not the sets of a library shared with e621 whose names read as adult: utils/sfwWords.)
  return library.list.filter((s) => (!f || s.name.toLowerCase().includes(f) || s.shortname.includes(f)) && !(sites.sfw && looksExplicit(s.name, s.shortname))).map(fromSaved)
})

// ---------- covers: the first post the site shows among a set's first few ----------
async function loadCovers(list: Row[]) {
  const want = [...new Set(list.flatMap((r) => r.coverIds))].filter((id) => !covers.value.has(id))
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
function coverOf(r: Row): Post | undefined {
  for (const id of r.coverIds) {
    const c = covers.value.get(id)
    if (c) return c
  }
  return undefined
}

function toggleSave(r: Row) {
  const set = found.value.find((s) => s.id === r.id) ?? mine.byId(r.id)
  if (set) {
    const on = library.toggle(set)
    ui.toast(on ? 'Saved to the set library' : 'Removed from the set library', { tone: on ? 'ok' : undefined })
  } else if (library.isSaved(r.id)) {
    library.remove(r.id)
    ui.toast('Removed from the set library')
  }
}
function onRowMenu(e: MouseEvent, r: Row) {
  const href = router.resolve(`/sets/${r.id}`).href
  openMenu(
    e,
    [
      { label: 'Open', icon: 'chevron-right', href, run: () => void router.push(`/sets/${r.id}`) },
      { label: 'Open in a new tab', icon: 'external', run: () => openInNewTab(href) },
      {
        label: `Search set:${r.shortname}`,
        icon: 'search',
        href: router.resolve({ path: '/posts', query: { q: `set:${r.shortname}` } }).href,
        run: () => void router.push({ path: '/posts', query: { q: `set:${r.shortname}` } }),
      },
      'sep',
      { label: library.isSaved(r.id) ? 'Remove from the library' : 'Save to the library', icon: library.isSaved(r.id) ? 'bookmark-on' : 'bookmark', run: () => toggleSave(r) },
    ],
    r.name,
  )
}
// Pull down at the top: the tab's list again (collections are local: nothing to reload).
useRefresh(
  () => (tab.value === 'browse' ? browse(true) : tab.value === 'library' ? refreshLibrary() : mine.load(true)),
  () => tab.value !== 'collections' && (tab.value !== 'mine' || mine.available),
)
</script>

<template>
  <div class="page-narrow">
    <div class="page-head flat">
      <h1 v-decode="'// Sets'"></h1>
      <Segmented v-model="tab" :options="tabs" label="Sets" />
      <template v-if="tab === 'collections'">
        <input v-if="collections.count > 4" v-model="collFilter" class="rv-input q" type="search" placeholder="Filter collections" aria-label="Filter collections by name" />
        <select v-if="collections.count > 1" v-model="collSort" class="rv-select ord" aria-label="Sort collections">
          <option value="updated">Recently changed</option>
          <option value="name">Name</option>
          <option value="size">Most posts</option>
        </select>
      </template>
      <template v-else-if="tab === 'browse'">
        <input v-model="name" class="rv-input q" type="search" placeholder="Find a set by name" aria-label="Set name" />
        <select v-model="order" class="rv-select ord" aria-label="Sort">
          <option value="updated_at">Recently updated</option>
          <option value="created_at">Newest</option>
          <option value="name">Name</option>
        </select>
      </template>
      <input v-else-if="tab === 'library'" v-model="libFilter" class="rv-input q" type="search" placeholder="Filter the library" aria-label="Filter the library by name" />
      <span class="grow"></span>
      <button v-if="tab === 'mine' && mine.available" class="rv-btn rv-btn--sm rv-btn--primary" type="button" @click="editing = true"><Icon name="plus" />New set…</button>
      <button v-if="tab === 'collections'" class="rv-btn rv-btn--sm rv-btn--primary" type="button" @click="makingColl = true"><Icon name="plus" />New collection…</button>
    </div>

    <template v-if="tab === 'collections'">
      <div v-if="shownColls.length" class="sets">
        <div v-for="c in shownColls" :key="c.id" class="item" @contextmenu="onCollMenu($event, c)">
          <RouterLink :to="`/collections/${c.id}`" class="set coll">
            <span class="cover" :class="`n${Math.min(collCovers(c).length, 4)}`">
              <img v-for="(u, i) in collCovers(c)" :key="i" :src="u" alt="" loading="lazy" decoding="async" />
              <Icon v-if="!collCovers(c).length" name="collection" class="nocover" :size="18" aria-hidden="true" />
            </span>
            <span class="meta">
              <span class="sname">{{ c.name }}</span>
              <span class="readout">{{ c.items.length }} post{{ c.items.length === 1 ? '' : 's' }} // updated {{ relativeTime(new Date(c.updatedAt).toISOString()) }} // this browser</span>
              <span v-if="c.description" class="desc">{{ c.description }}</span>
            </span>
            <Icon name="chevron-right" class="go" />
          </RouterLink>
        </div>
      </div>
      <div v-else-if="collections.count" class="state"><StatePanel label="No collection" :message="`No collection name contains « ${collFilter} ».`" /></div>
      <div v-else class="state">
        <StatePanel
          label="Collections // none yet"
          message="Collections are lists of posts kept in this browser, without an account: make one here, or from any post (right-click or long press › Add to collection…), or put all the posts of a page in one with its collection button."
        >
          <template #actions><button class="rv-btn rv-btn--primary" type="button" @click="makingColl = true"><Icon name="plus" />New collection…</button></template>
        </StatePanel>
      </div>
    </template>

    <div v-else-if="tab === 'mine' && !mine.available" class="state">
      <StatePanel
        label="Your sets // account needed"
        message="Sets are made and filled with an account on the site. Add your user name and API key to this site in Settings › Sites; sets of others can still be browsed and kept in the library."
      >
        <template #actions><RouterLink class="rv-btn rv-btn--primary" to="/settings/sites">Settings › Sites</RouterLink></template>
      </StatePanel>
    </div>

    <div v-else-if="rows.length" class="sets">
      <div v-for="r in rows" :key="r.id" class="item" @contextmenu="onRowMenu($event, r)">
        <RouterLink :to="`/sets/${r.id}`" class="set">
          <span class="cover">
            <img v-if="coverOf(r)" :src="(coverOf(r)!.previewUrl ?? coverOf(r)!.sampleUrl)!" :class="{ masked: blacklist.match(coverOf(r)!) }" alt="" loading="lazy" decoding="async" />
            <Icon v-else name="sets" class="nocover" :size="18" aria-hidden="true" />
          </span>
          <span class="meta">
            <span class="sname">{{ r.name }}</span>
            <span class="readout">
              {{ r.postCount }} posts<template v-if="r.updatedAt"> // updated {{ relativeTime(r.updatedAt) }}</template><template v-if="!r.isPublic"> // private</template> // set:{{ r.shortname }}
            </span>
            <span v-if="r.description" class="desc">{{ dtextExcerpt(r.description, 160) }}</span>
          </span>
          <Icon name="chevron-right" class="go" />
        </RouterLink>
        <button
          class="rv-icon-btn save"
          :class="{ 'is-on': library.isSaved(r.id) }"
          type="button"
          :aria-pressed="library.isSaved(r.id)"
          :title="library.isSaved(r.id) ? 'Remove from the library' : 'Save to the library'"
          @click="toggleSave(r)"
        >
          <Icon :name="library.isSaved(r.id) ? 'bookmark-on' : 'bookmark'" />
        </button>
      </div>
    </div>

    <template v-if="tab === 'browse'">
      <div v-if="error" class="state">
        <StatePanel label="Sets failed" :message="error" alert>
          <template #actions><button class="rv-btn rv-btn--primary" type="button" @click="browse(!found.length)">Retry</button></template>
        </StatePanel>
      </div>
      <div v-else-if="loading && !found.length" class="state"><StatePanel label="Loading" loading /></div>
      <div v-else-if="!found.length" class="state"><StatePanel label="No sets" :message="name ? `No set name contains « ${name} ».` : 'No sets.'" /></div>
      <div v-else-if="!done" class="more">
        <button class="rv-btn" type="button" :disabled="loading" @click="browse(false)">{{ loading ? 'Loading…' : 'More sets' }}</button>
      </div>
    </template>
    <template v-else-if="tab === 'library'">
      <div v-if="!library.count" class="state">
        <StatePanel label="Library // empty" message="Keep a set with its bookmark, here or on the set's page: it stays in this browser, with or without an account." />
      </div>
      <div v-else-if="!rows.length" class="state"><StatePanel label="No saved set" :message="`No saved set name contains « ${libFilter} ».`" /></div>
    </template>
    <template v-else-if="tab === 'mine' && mine.available">
      <div v-if="mine.loading && !mine.loaded" class="state"><StatePanel label="Loading your sets" loading /></div>
      <div v-else-if="mine.error" class="state">
        <StatePanel label="Your sets failed" :message="mine.error" alert>
          <template #actions><button class="rv-btn rv-btn--primary" type="button" @click="mine.load(true)">Retry</button></template>
        </StatePanel>
      </div>
      <div v-else-if="!mine.sets.length" class="state">
        <StatePanel label="No set yet" message="Make one with New set…, or from any post: right-click › Add to set… (or the Add to set button of a page, for all its posts).">
          <template #actions><button class="rv-btn rv-btn--primary" type="button" @click="editing = true"><Icon name="plus" />New set…</button></template>
        </StatePanel>
      </div>
    </template>

    <SetEditDialog v-if="editing" @close="editing = false" @saved="onCreated" />
    <CollectionEditDialog v-if="makingColl" @close="makingColl = false" @saved="onCollMade" />
    <CollectionEditDialog v-if="editingColl" :collection="editingColl" @close="editingColl = null" @saved="editingColl = null" />
  </div>
</template>

<style scoped>
.page-head.flat {
  position: static;
}
.q {
  width: min(280px, 100%);
}
.ord {
  width: auto;
}
.sets {
  display: grid;
  border-top: 1px solid var(--line);
}
.item {
  position: relative;
  border-bottom: 1px solid var(--line);
}
.set {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 84px 8px 8px;
  color: var(--text);
  text-decoration: none;
}
.set:hover {
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
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover img.masked {
  visibility: hidden;
}
/* A collection's cover: up to four pictures in a square. */
.coll .cover {
  display: grid;
  gap: 1px;
}
.coll .cover.n2 {
  grid-template-columns: 1fr 1fr;
}
.coll .cover.n3,
.coll .cover.n4 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}
.coll .cover.n3 img:first-child {
  grid-row: span 2;
}
.coll .cover img {
  min-width: 0;
  min-height: 0;
}
.coll {
  padding-right: 40px;
}
.cover .nocover {
  position: absolute;
  inset: 0;
  margin: auto;
  color: var(--text-3);
}
.meta {
  display: grid;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.sname {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.readout {
  font-size: 0.625rem;
  overflow-wrap: anywhere;
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
.more {
  display: grid;
  place-items: center;
  padding: 18px 0;
}
.state {
  display: grid;
  place-items: center;
  padding: 32px 0;
}
@media (max-width: 560px) {
  .cover {
    width: 52px;
    height: 52px;
  }
  .set {
    gap: 10px;
    padding-right: 72px;
  }
  .q {
    width: 100%;
  }
}
</style>
