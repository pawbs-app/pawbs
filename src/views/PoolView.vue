<script setup lang="ts">
import { vDecode } from '@/directives/decode'
import { computed, nextTick, onActivated, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRefresh } from '@/services/refresh'
import PostGrid from '@/components/PostGrid.vue'
import PageMore from '@/components/PageMore.vue'
import GridTools from '@/components/GridTools.vue'
import BulkSaveDialog from '@/components/BulkSaveDialog.vue'
import StatePanel from '@/components/StatePanel.vue'
import Icon from '@/components/Icon.vue'
import PoolStrip from '@/components/PoolStrip.vue'
import Segmented from '@/components/Segmented.vue'
import { usePoolProgress } from '@/stores/poolProgress'
import type { Post } from '@/api/types'
import { cachedFeed, createFeed, withoutFlash, type Feed } from '@/services/feed'
import { getPool, searchPosts } from '@/api/endpoints'
import type { Pool } from '@/api/types'
import { useGallery } from '@/stores/gallery'
import { useSites } from '@/stores/sites'
import { useSettings } from '@/stores/settings'
import { usePoolLibrary } from '@/stores/poolLibrary'
import { useUi } from '@/stores/ui'
import { useViewerNav } from '@/composables/viewerNav'
import { prettyTag } from '@/query/syntax'
import { renderDText } from '@/utils/dtext'
import { relativeTime } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const gallery = useGallery()
const sites = useSites()
const nav = useViewerNav()
const settings = useSettings()
const library = usePoolLibrary()
const ui = useUi()
const progress = usePoolProgress()

const pool = shallowRef<Pool | null>(null)
const error = ref<string | null>(null)
const feed = shallowRef<Feed | null>(null)
const bulk = ref(false)
const CHUNK = 100

/* Posts in the pool's own order: ids are fetched in chunks and sorted to match. */
function poolFeed(p: Pool, blockFlash: boolean): Feed {
  const f = createFeed(`pool:${p.id}`, p.name, async ({ page, signal, priority }) => {
    const ids = p.postIds.slice((page - 1) * CHUNK, page * CHUNK)
    if (!ids.length) return { posts: [], done: true }
    const posts = await searchPosts(`id:${ids.join(',')} status:any`, { limit: CHUNK, signal, priority })
    const at = new Map(ids.map((id, i) => [id, i]))
    posts.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0))
    return { posts: withoutFlash(posts, blockFlash), done: page * CHUNK >= p.postIds.length }
  })
  f.total = p.postCount
  return f
}

let currentKey = ''
/** Counted up by Retry: the page loads again (after a failure there is nothing else on it to press). */
const again = ref(0)
watch(
  () => [route.name, route.params.id, sites.scope, settings.s.blockFlash, again.value] as const,
  async ([name, id, , block]) => {
    if (name !== 'pool') return
    const pid = Number(id)
    const at = route.path
    // (The same pool of the same site: pool numbers repeat from one site to another.)
    if (pool.value?.id === pid && currentKey.startsWith(`pool:${sites.scope}:`) && currentKey.endsWith(`:${block}`)) return
    pool.value = null
    error.value = null
    feed.value = null
    try {
      const p = await getPool(pid)
      // Left meanwhile (another pool, back to a list): this answer is for a page no longer shown.
      if (route.path !== at) return
      if (!p) throw new Error('This pool does not exist.')
      pool.value = p
      library.markSeen(p) // a saved pool: its pages so far now count as seen
      currentKey = `pool:${sites.scope}:${p.id}:${p.updatedAt}:${block}`
      const f = cachedFeed(currentKey, () => poolFeed(p, block))
      feed.value = f
      gallery.setFeed(f, at)
      if (!f.posts.value.length && !f.done.value) void f.loadMore()
    } catch (e) {
      if (route.path === at) error.value = (e as Error).message
    }
  },
  { immediate: true },
)
onActivated(() => feed.value && gallery.setFeed(feed.value))

const description = computed(() => (pool.value ? renderDText(pool.value.description, sites.origin) : ''))
function onDescClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a[data-route]') as HTMLAnchorElement | null
  if (a) {
    e.preventDefault()
    router.push(a.dataset.route!)
  }
}
function toggleSave() {
  if (!pool.value) return
  const on = library.toggle(pool.value)
  ui.toast(on ? 'Saved to the pool library' : 'Removed from the pool library', { tone: on ? 'ok' : undefined })
}
// ---------- reading: from the start, or where it was left ----------
const readers = [
  { value: 'grid', label: 'Pages', icon: 'grid', title: 'Pages as a grid' },
  { value: 'scroll', label: 'Scroll', icon: 'rows', title: 'Pages one under the other, to scroll' },
]
const strip = ref<InstanceType<typeof PoolStrip> | null>(null)
/** Page number of a post in this pool (1 = first). */
const pageIndex = computed(() => new Map((pool.value?.postIds ?? []).map((id, i) => [id, i + 1])))
const pageOf = (p: Post) => pageIndex.value.get(p.id) ?? 0
const left = computed(() => {
  const r = pool.value && progress.get(pool.value.id)
  return r && r.page > 1 && r.page <= pool.value!.postCount ? r.page : 0
})
function mark(page: number) {
  if (pool.value && page > 0) progress.mark(pool.value.id, page, pool.value.postCount)
}
// A page shown in the gallery counts as read.
watch(
  () => route.query.post,
  (id) => {
    if (route.name === 'pool' && id) mark(pageIndex.value.get(Number(id)) ?? 0)
  },
)

/** The post at (or just after) a page, loading the pool that far. */
async function postAt(page: number): Promise<Post | undefined> {
  const f = feed.value
  if (!f) return undefined
  const find = () => f.posts.value.find((p) => pageOf(p) >= page)
  while (!find() && !f.done.value && !f.error.value) await f.loadMore()
  return find()
}
async function readFrom(page: number) {
  const p = await postAt(page)
  if (!p) return
  if (settings.s.poolReader === 'scroll') {
    await nextTick()
    strip.value?.scrollToPage(pageOf(p))
  } else nav.openPost(p)
}
function read() {
  if (settings.s.poolReader === 'scroll') window.scrollTo({ top: 0 })
  else void readFrom(1)
}
// Pull down at the top: the pages again.
useRefresh(() => feed.value?.reload())
</script>

<template>
  <div class="page">
    <div v-if="error" class="state"><StatePanel label="Pool // not available" :message="error" alert><template #actions><button class="rv-btn" type="button" @click="again++">Retry</button></template></StatePanel></div>
    <template v-else-if="pool">
      <div class="page-head">
        <RouterLink to="/pools" class="rv-icon-btn" title="All pools"><Icon name="arrow-left" /></RouterLink>
        <h1 v-decode="'// ' + prettyTag(pool.name)" class="ellipsis grow" :class="{ 'wide-title': pool.name.length > 12 }"></h1>
        <span class="readout hide-s">{{ pool.category }} // <b>{{ pool.postCount }}</b> posts // updated {{ relativeTime(pool.updatedAt) }}</span>
        <button v-if="left" class="rv-btn rv-btn--sm rv-btn--primary" type="button" :title="`Continue where you left off: page ${left} of ${pool.postCount}`" @click="readFrom(left)">
          <Icon name="play" />Continue<span class="hide-s">&nbsp;· p.&nbsp;{{ left }}</span>
        </button>
        <button class="rv-btn rv-btn--sm" :class="{ 'rv-btn--primary': !left }" type="button" :disabled="!feed?.posts.value.length" :title="left ? 'Read from the first page' : 'Read'" @click="read">
          <Icon :name="left ? 'retry' : 'play'" /><span v-if="left" class="hide-s">From the start</span><template v-else>Read</template>
        </button>
        <Segmented v-model="settings.s.poolReader" :options="readers" label="Reading" />
        <button data-keep
          class="rv-icon-btn"
          :class="{ 'is-active': library.isSaved(pool.id) }"
          type="button"
          :aria-pressed="library.isSaved(pool.id)"
          :title="library.isSaved(pool.id) ? 'Remove from the pool library' : 'Save to the pool library'"
          @click="toggleSave"
        >
          <Icon :name="library.isSaved(pool.id) ? 'bookmark-on' : 'bookmark'" />
        </button>
        <button class="rv-icon-btn" type="button" title="Add the loaded pages to a collection…" :disabled="!feed?.posts.value.length" @click="ui.addToSet = { posts: feed!.posts.value, title: pool.name }">
          <Icon name="collection" />
        </button>
        <button class="rv-icon-btn" type="button" title="Save the loaded posts…" :disabled="!feed?.posts.value.length" @click="bulk = true"><Icon name="download" /></button>
        <a v-if="sites.active" class="rv-icon-btn" :href="`${sites.active.url}/pools/${pool.id}`" target="_blank" rel="noopener noreferrer" :title="`Open on ${sites.active.name}`"><Icon name="external" /></a>
        <GridTools v-if="settings.s.poolReader !== 'scroll'" />
        <PageMore />
      </div>
      <div v-if="pool.description" class="dtext pdesc" @click="onDescClick" v-html="description"></div>
      <p v-if="feed && feed.done.value && feed.posts.value.length < pool.postCount" class="rv-hint note">
        {{ pool.postCount - feed.posts.value.length }} of its pages are not shown: hidden from guests or by this site, or filtered out (Flash).
      </p>
      <PoolStrip
        v-if="feed && settings.s.poolReader === 'scroll'"
        ref="strip"
        :posts="feed.posts.value"
        :loading="feed.loading.value"
        :done="feed.done.value"
        :error="feed.error.value"
        :page-of="pageOf"
        :total="pool.postCount"
        @open="nav.openPost"
        @page="mark"
        @more="feed.loadMore($event)"
        @retry="feed.loadMore()"
      />
      <PostGrid
        v-else-if="feed"
        :posts="feed.posts.value"
        :loading="feed.loading.value"
        :done="feed.done.value"
        :error="feed.error.value"
        :href-for="nav.hrefFor"
        empty-label="Empty pool"
        @open="nav.openPost"
        @more="feed.loadMore($event)"
        @retry="feed.loadMore()"
      />
      <BulkSaveDialog v-if="bulk && feed" :posts="feed.posts.value" :title="pool.name" @close="bulk = false" />
    </template>
    <div v-else class="state"><StatePanel label="Loading pool" loading /></div>
  </div>
</template>

<style scoped>
.pdesc {
  margin: 0 0 12px;
  max-height: 9em;
  overflow-y: auto;
}
.note {
  margin: 0 0 10px;
}
.page-head a.rv-icon-btn {
  text-decoration: none;
}
@media (max-width: 760px) {
  .hide-s {
    display: none;
  }
}
</style>
