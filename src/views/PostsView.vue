<script setup lang="ts">
import { vDecode } from '@/directives/decode'
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, shallowRef, watch } from 'vue'
import { relativeTime } from '@/utils/format'
import { useRoute, useRouter } from 'vue-router'
import { useRefresh } from '@/services/refresh'
import { freshAnswers } from '@/api/client'
import PostGrid from '@/components/PostGrid.vue'
import StatePanel from '@/components/StatePanel.vue'
import PageMore from '@/components/PageMore.vue'
import GridTools from '@/components/GridTools.vue'
import RelatedTags from '@/components/RelatedTags.vue'
import BulkSaveDialog from '@/components/BulkSaveDialog.vue'
import Icon from '@/components/Icon.vue'
import ArtistLinks from '@/components/ArtistLinks.vue'
import JumpDateDialog from '@/components/JumpDateDialog.vue'
import { useTagCache } from '@/stores/tagcache'
import { cachedFeed, effectiveQuery, searchFeed, type Feed } from '@/services/feed'
import { useSettings } from '@/stores/settings'
import { useSites } from '@/stores/sites'
import { useSearches } from '@/stores/searches'
import { useFollows } from '@/stores/follows'
import { useGallery } from '@/stores/gallery'
import { useUi } from '@/stores/ui'
import { useViewerNav } from '@/composables/viewerNav'
import { useVisiblePosts } from '@/composables/visible'
import { atDate, checkQuery, dateLimit, positiveTags, prettyTag, tooManyTerms, withTag } from '@/query/syntax'
import { openAssistant } from '@/composables/assistant'

const route = useRoute()
const router = useRouter()
const settings = useSettings()
const sites = useSites()
const searches = useSearches()
const follows = useFollows()
const gallery = useGallery()
const ui = useUi()
const nav = useViewerNav()

const query = ref('')
const feed = shallowRef<Feed | null>(null)
const posts = computed(() => feed.value?.posts.value ?? [])
const { hiddenCount, hiddenIds, visible } = useVisiblePosts(posts)
// Refine counts what the page shows: no blacklisted post (hidden or masked), none marked not interested.
const shownPosts = computed(() => (hiddenIds.value.size ? visible.value.filter((p) => !hiddenIds.value.has(p.id)) : visible.value))
const bulk = ref(false)
/** A followed search on screen: the newest post seen before (and when), and what it shows now. */
const newFrom = ref<{ id: number; at?: number } | null>(null)
let pending: { tag: string; newest: number } | null = null

let currentKey = ''
function keyFor(q: string) {
  const opts = { defaultFilter: settings.s.defaultFilter, blockFlash: settings.s.blockFlash }
  return `search:${sites.scope}:${settings.s.pageSize}:${effectiveQuery(q, opts)}`
}

function open(q: string) {
  flushSeen() // the follow left behind (another search in its place) counts as seen up to what it showed
  query.value = q
  // A followed search: what was new since it was last seen, for the line and the NEW marks.
  const fol = q ? follows.find(q) : undefined
  newFrom.value = fol && fol.lastSeen ? { id: fol.lastSeen, at: fol.seenAt } : null
  const opts = { pageSize: settings.s.pageSize, defaultFilter: settings.s.defaultFilter, blockFlash: settings.s.blockFlash }
  currentKey = keyFor(q)
  // More terms than the site takes: it would answer with an error and a Retry that cannot work.
  // Not asked; the page says why (the hint, and the panel in the grid's place).
  if (tooManyTerms(q)) {
    feed.value = null
    return
  }
  const f = cachedFeed(currentKey, () => searchFeed(q, opts))
  feed.value = f
  gallery.setFeed(f)
  if (!f.posts.value.length && !f.loading.value && !f.done.value) void f.loadMore()
  if (q) searches.remember(q)
}

// A new query, site or filter setting opens the matching feed (cached ones come back as they were).
watch(
  () => [route.name, route.query.q, sites.scope, settings.s.blockFlash, settings.s.defaultFilter, settings.s.pageSize] as const,
  ([name, q]) => {
    if (name !== 'posts') return
    const next = typeof q === 'string' ? q.trim() : ''
    if (feed.value && keyFor(next) === currentKey) return
    open(next)
  },
  { immediate: true },
)
onActivated(() => feed.value && gallery.setFeed(feed.value))

/* A followed tag or search: its new posts carry NEW and, newest first, a line parts them from the
   ones seen before. They count as seen once the page is left (another page, another search, the app
   closed), up to the newest post it showed: not as soon as it opens, which hid what was new. */
watch(
  () => posts.value.length,
  () => {
    const f = query.value ? follows.find(query.value) : undefined
    if (!f || !posts.value.length) return
    let newest = pending?.tag === f.tag ? pending.newest : 0
    for (const p of posts.value) if (p.id > newest) newest = p.id
    pending = { tag: f.tag, newest }
  },
)
function flushSeen() {
  if (pending) follows.markSeen(pending.tag, pending.newest)
  pending = null
}
onDeactivated(flushSeen)
onBeforeUnmount(flushSeen)
window.addEventListener('pagehide', flushSeen)
onBeforeUnmount(() => window.removeEventListener('pagehide', flushSeen))
const newCount = computed(() => (newFrom.value ? shownPosts.value.reduce((n, p) => n + (p.id > newFrom.value!.id ? 1 : 0), 0) : 0))
/** The line's words, when the list runs newest first (no order: of its own). */
const newLabel = computed(() => {
  if (!newFrom.value || /(^|\s)-?order:/i.test(query.value)) return undefined
  return newFrom.value.at ? `Seen before // last look ${relativeTime(newFrom.value.at)}` : 'Seen before'
})

const issues = computed(() => checkQuery(query.value).filter((i) => i.level === 'error'))
/** The query as the page quotes it: a very long one is cut (the heading and the field keep it whole). */
const quoted = computed(() => (query.value.length > 120 ? query.value.slice(0, 117) + '…' : query.value))
const single = computed(() => {
  const t = positiveTags(query.value)
  return t.length === 1 && query.value.trim() === t[0] ? t[0] : null
})
const followed = computed(() => (query.value ? !!follows.find(query.value) : false))
// A search for one artist: their links above the results ("More by…" lands here).
const tagcache = useTagCache()
const artist = computed(() => (single.value && tagcache.category(single.value) === 1 ? single.value : null))
function addLoadedToSet() {
  if (posts.value.length) ui.addToSet = { posts: posts.value, title: query.value || 'Latest posts' }
}

/* Any search can be followed (a tag, an artist, a whole query): its new posts are counted on
   Following. One term is kept for the check's own (id:>), so a search at the site's limit cannot. */
const followBlocked = computed(() => !query.value || tooManyTerms(`${query.value} id:>1`))
function toggleFollow() {
  const q = query.value
  if (!q) return
  const was = followed.value
  if (!was && followBlocked.value) return
  follows.toggle(q)
  pending = null
  const what = single.value ? prettyTag(single.value) : 'this search'
  ui.toast(was ? `Unfollowed ${what}` : `Following ${what} → new posts show on Following`, { tone: was ? undefined : 'ok' })
}
function refine(tag: string, exclude: boolean) {
  router.push({ path: '/posts', query: { q: withTag(query.value, tag, exclude ? '-' : '') } })
}
// Jump to a date: the same search from a day back.
const jumping = ref(false)
const since = computed(() => dateLimit(query.value))
function jumpTo(day: string | null) {
  jumping.value = false
  void router.push({ path: '/posts', query: { q: atDate(query.value, day) } })
}
async function reload() {
  freshAnswers() // the site's answer now, not the one kept from a minute ago
  await feed.value?.reload()
}
// Pull down at the top: the search again.
useRefresh(reload)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1 v-decode="'// ' + (query || 'Latest posts')" class="ellipsis grow" :class="{ 'wide-title': query.length > 12 }" :title="query"></h1>
      <span v-if="posts.length || feed?.done.value" class="readout hide-s">
        <!-- What is loaded so far (the site gives no total for a search): "loaded" until the end is reached. -->
        <b>{{ posts.length }}</b> {{ feed?.done.value ? (posts.length === 1 ? 'post' : 'posts') : 'loaded' }}<template v-if="newCount"> // <b>{{ newCount }}</b> new</template><template v-if="hiddenCount"> // {{ hiddenCount }} blacklisted</template>
      </span>
      <button
        v-if="query"
        class="rv-btn rv-btn--sm"
        :class="{ on: followed }"
        type="button"
        :disabled="!followed && followBlocked"
        :title="followed ? 'Stop following' : followBlocked ? 'Too many terms to follow: the check needs one of its own' : `Follow: count the new posts of ${single ? 'this tag' : 'this search'} on Following`"
        @click="toggleFollow"
      >
        <Icon name="eye" />{{ followed ? 'Following' : 'Follow' }}
      </button>
      <!-- Icons, with their words on wide screens (.tb). -->
      <button class="rv-icon-btn tb" type="button" title="Add the loaded posts to a collection…" :disabled="!posts.length" @click="addLoadedToSet"><Icon name="collection" /><span class="lbl">Collect</span></button>
      <button class="rv-icon-btn tb" type="button" title="Save the loaded posts…" :disabled="!posts.length" @click="bulk = true"><Icon name="download" /><span class="lbl">Download</span></button>
      <button
        class="rv-icon-btn tb"
        :class="{ 'is-active': since }"
        type="button"
        :title="since ? `From ${since} back: change the date…` : 'Jump to a date…'"
        @click="jumping = true"
      >
        <Icon name="calendar" /><span class="lbl">{{ since ? since : 'Date' }}</span>
      </button>
      <button class="rv-icon-btn tb" type="button" title="Reload" @click="reload"><Icon name="retry" /><span class="lbl">Reload</span></button>
      <GridTools />
      <PageMore />
    </div>

    <p v-if="issues.length" class="rv-hint bad issue">{{ issues[0].message }}</p>
    <ArtistLinks v-if="artist" :key="artist" class="artistbar" :name="artist" compact @navigate="router.push($event)" />
    <RelatedTags :posts="shownPosts" :query="query" @add="refine" />

    <PostGrid
      v-if="feed"
      :posts="posts"
      :loading="feed.loading.value"
      :done="feed.done.value"
      :error="feed.error.value"
      :href-for="nav.hrefFor"
      :new-since="newFrom?.id"
      :new-label="newLabel"
      empty-label="No posts"
      :empty-message="query ? `Nothing matches « ${quoted} ». Check the spelling, or loosen a filter in the query assistant (Q).` : 'The site returned no posts.'"
      @open="nav.openPost"
      @more="feed.loadMore()"
      @retry="feed.loadMore()"
    >
      <template #empty>
        <div class="row">
          <button class="rv-btn" type="button" @click="openAssistant()"><Icon name="sliders" />Query assistant</button>
        </div>
      </template>
    </PostGrid>
    <div v-else-if="tooManyTerms(query)" class="state">
      <StatePanel label="Not searched" message="This search has more terms than the site accepts in one. Remove some to search.">
        <template #actions>
          <button class="rv-btn" type="button" @click="openAssistant()"><Icon name="sliders" />Query assistant</button>
        </template>
      </StatePanel>
    </div>

    <BulkSaveDialog v-if="bulk" :posts="posts" :title="query || 'latest'" @close="bulk = false" />
    <JumpDateDialog v-if="jumping" :query="query" @close="jumping = false" @go="jumpTo" />
  </div>
</template>

<style scoped>
.artistbar {
  margin: 0 0 10px;
}

.issue {
  margin: -4px 0 8px;
}
.rv-btn.on {
  border-color: var(--text);
}
/* The toolbar's words: wide screens only (narrower ones keep the icons and their tooltips). */
.tb .lbl {
  display: none;
}
@media (min-width: 1200px) {
  .tb {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    width: auto;
    padding: 0 10px;
    font-size: 0.625rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .tb .lbl {
    display: inline;
  }
}
@media (max-width: 760px) {
  .hide-s {
    display: none;
  }
}
</style>
