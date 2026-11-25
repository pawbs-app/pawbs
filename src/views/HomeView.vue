<script setup lang="ts">
import { vNewTab } from '@/directives/newTab'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useKeyLayer } from '@/services/keyboard'
import { useRouter } from 'vue-router'
import { useRefresh } from '@/services/refresh'
import SearchBox from '@/components/SearchBox.vue'
import Icon from '@/components/Icon.vue'
import PawMark from '@/components/PawMark.vue'
import { openAssistant as showAssistant } from '@/composables/assistant'
import { useSearches } from '@/stores/searches'
import { useFollows } from '@/stores/follows'
import { useHistory } from '@/stores/history'
import { useFavorites } from '@/stores/favorites'
import { useSites } from '@/stores/sites'
import { useUi } from '@/stores/ui'
import { useInstall } from '@/composables/install'
import { useInbox } from '@/composables/inbox'
import InboxRows from '@/components/InboxRows.vue'
import { prettyTag } from '@/query/syntax'
import { relativeTime } from '@/utils/format'
import type { Post } from '@/api/types'
import { openInNewTab, openMenu } from '@/services/contextMenu'
import { useQueryMenus } from '@/composables/queryMenus'
import { usePostActions } from '@/composables/postActions'
import { getRisingTags, getSearchTrends } from '@/api/endpoints'
import type { SearchTrend, TagInfo } from '@/api/types'
import { useBlacklist } from '@/stores/blacklist'
import { useSettings } from '@/stores/settings'
import { formatCount } from '@/utils/format'
import { vDecode } from '@/directives/decode'

const router = useRouter()
const searches = useSearches()
const follows = useFollows()
const history = useHistory()
const favorites = useFavorites()
const sites = useSites()
const ui = useUi()
const { canInstall, install } = useInstall()

const text = ref('')
const box = ref<InstanceType<typeof SearchBox> | null>(null)
onMounted(() => {
  // Ready to type into on a computer, without opening the saved and recent searches over the page.
  if (window.matchMedia('(pointer: fine)').matches) box.value?.focus({ quiet: true })
})
/* One search field at a time: while this large one is on screen, the title bar's steps aside
   (TitleBar), and "/" comes here. Scrolled past it, the bar's is back. */
let seen: IntersectionObserver | null = null
onMounted(() => {
  const el = box.value?.$el as Element | undefined
  if (!el) return
  const barH = Math.round(document.querySelector('.tbar')?.getBoundingClientRect().height ?? 40)
  seen = new IntersectionObserver(([e]) => (ui.homeSearchShown = e.isIntersecting), { rootMargin: `-${barH}px 0px 0px 0px` })
  seen.observe(el)
})
onBeforeUnmount(() => {
  seen?.disconnect()
  ui.homeSearchShown = false
})
useKeyLayer((e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || !ui.homeSearchShown) return false
  box.value?.focus()
  return true
})

function go(q: string) {
  router.push({ path: '/posts', query: q ? { q } : {} })
}
function openAssistant() {
  ui.searchText = text.value
  showAssistant()
}
const recentPosts = computed(() => history.posts.slice(0, 14))
/* Everything followed, what has news first: the reason to come back, at the top. */
const inbox = useInbox()
const INBOX_SHOWN = 10
const inboxTop = computed(() => inbox.entries.value.slice(0, INBOX_SHOWN))

// Right-click menus: searches, follows and recently viewed posts.
const menus = useQueryMenus()
const actions = usePostActions()
function onRecentMenu(e: MouseEvent, q: string) {
  openMenu(e, [...menus.searchEntries(q), 'sep', { label: 'Remove from history', icon: 'trash', run: () => searches.forget(q) }], q)
}
function onMiniMenu(e: MouseEvent, p: Post) {
  const href = (e.currentTarget as HTMLAnchorElement | null)?.href ?? ''
  openMenu(
    e,
    [
      { label: 'Open', icon: 'eye', href: href || undefined, run: () => void router.push({ path: '/history', query: { post: String(p.id) } }) },
      { label: 'Open in a new tab', icon: 'external', disabled: !href, run: () => openInNewTab(href) },
      'sep',
      ...actions.postEntries(p),
    ],
    `Post #${p.id}`,
  )
}
/* What the site is looking at: the tags searched most today, and the ones gaining posts fast. A tag
   named in the blacklist (in any line) is not offered. Asked for once in a while (cached 15 min). */
const settings = useSettings()
const blacklist = useBlacklist()
const trends = shallowRef<SearchTrend[]>([])
const rising = shallowRef<TagInfo[]>([])
const hiddenTags = computed(() => {
  if (!blacklist.enabled) return new Set<string>()
  return new Set(
    blacklist.text
      .split('\n')
      .flatMap((l) => l.trim().toLowerCase().split(/\s+/))
      .map((t) => t.replace(/^[-~]/, ''))
      .filter((t) => t && !t.includes(':')),
  )
})
const trendTags = computed(() => trends.value.filter((t) => !hiddenTags.value.has(t.tag)).slice(0, 14))
const risingTags = computed(() => rising.value.filter((t) => !hiddenTags.value.has(t.name)).slice(0, 10))
/* Not on the safe board: the site's trends are those of both boards together, adult searches
   included. */
const showTrends = computed(() => settings.s.homeTrends && !sites.sfw)
async function loadTrends() {
  if (!showTrends.value || !sites.active) return
  const [t, r] = await Promise.allSettled([getSearchTrends(20), getRisingTags()])
  trends.value = t.status === 'fulfilled' ? t.value : []
  rising.value = r.status === 'fulfilled' ? r.value : []
}
watch(() => [showTrends.value, sites.scope] as const, loadTrends, { immediate: true })
// Pull down at the top: the trends again, and the follows' counts checked in the background.
useRefresh(() => {
  void follows.check(true)
  return loadTrends()
})
function onTrendMenu(e: MouseEvent, tag: string) {
  openMenu(e, menus.tagEntries(tag), prettyTag(tag))
}

const quick = [
  { label: 'Latest', q: '', icon: 'clock' },
  { label: 'Best this week', q: 'date:week order:score', icon: 'trend' },
  { label: 'Videos', q: '~type:webm ~type:mp4 order:score date:month', icon: 'play' },
  { label: 'Random', q: 'order:random score:>20', icon: 'shuffle' },
]
</script>

<template>
  <div class="page-narrow home">
    <section class="hero">
      <h1 class="name"><PawMark framed tap class="mark" /><span v-decode="'pawbs'"></span></h1>
      <p class="tag readout">
        {{ sites.active?.name }} // {{ sites.hasAccount ? sites.active?.username : 'guest' }}<template v-if="favorites.count"> // {{ favorites.count }} {{ favorites.count === 1 ? 'favourite' : 'favourites' }}</template>
      </p>
      <SearchBox ref="box" v-model="text" size="large" placeholder="Search tags: fox solo -comic" @submit="go" @assistant="openAssistant" />
      <div class="quick">
        <button v-for="q in quick" :key="q.label" v-new-tab="{ path: '/posts', query: { q: q.q } }" class="rv-btn rv-btn--sm" type="button" @click="go(q.q)" @contextmenu="openMenu($event, menus.searchEntries(q.q), q.label)">
          <Icon :name="q.icon" />{{ q.label }}
        </button>
        <RouterLink class="rv-btn rv-btn--sm" to="/popular"><Icon name="trend" />Popular</RouterLink>
        <button v-if="canInstall" class="rv-btn rv-btn--sm" type="button" title="Install pawbs as an app" @click="install"><Icon name="install" />Install app</button>
      </div>
    </section>

    <section class="block inbox">
      <div class="block-head">
        <h2 class="rv-heading rv-label">Following</h2>
        <span v-if="inbox.total.value" class="readout"><b>{{ inbox.total.value }}</b> new</span>
        <span v-if="follows.checking" class="readout">Checking {{ Math.round(follows.progress * 100) }}%</span>
        <button v-else-if="inbox.entries.value.length" class="rv-small-btn" type="button" @click="follows.check(true)">Check now</button>
        <RouterLink v-if="inbox.entries.value.length" class="rv-small-btn" to="/following">All {{ inbox.entries.value.length }}</RouterLink>
      </div>
      <InboxRows v-if="inboxTop.length" :entries="inboxTop" cols />
      <p v-else class="rv-hint">Follow a tag, an artist or a whole search (the Follow button on its results), or save a pool, to see here what is new since you last looked.</p>
    </section>

    <section v-if="showTrends && (trendTags.length || risingTags.length)" class="trends">
      <div v-if="trendTags.length" class="trow">
        <span class="rv-label">Trending today</span>
        <button v-for="t in trendTags" :key="t.tag" v-new-tab="{ path: '/posts', query: { q: t.tag } }" class="chip" type="button" :title="`Searched ${t.count} times today`" @click="go(t.tag)" @contextmenu="onTrendMenu($event, t.tag)">
          <span class="t">{{ prettyTag(t.tag) }}</span>
        </button>
      </div>
      <div v-if="risingTags.length" class="trow">
        <span class="rv-label">Rising</span>
        <button v-for="t in risingTags" :key="t.name" v-new-tab="{ path: '/posts', query: { q: t.name } }" class="chip" type="button" :title="`${formatCount(t.postCount)} posts`" @click="go(t.name)" @contextmenu="onTrendMenu($event, t.name)">
          <span class="t" :class="'cat-' + t.category">{{ prettyTag(t.name) }}</span>
        </button>
      </div>
    </section>

    <div class="cols">
      <section class="block">
        <div class="block-head">
          <h2 class="rv-heading rv-label">Recent searches</h2>
          <button v-if="searches.recent.length" class="rv-small-btn" type="button" @click="searches.clearRecent()">Clear</button>
        </div>
        <div v-if="searches.recent.length" class="rows">
          <div v-for="r in searches.recent.slice(0, 10)" :key="r.q" class="r" @contextmenu="onRecentMenu($event, r.q)">
            <button v-new-tab="{ path: '/posts', query: { q: r.q } }" class="main" type="button" @click="go(r.q)">
              <Icon name="search" />
              <span class="grow ellipsis">{{ r.q }}</span>
              <span class="sub hide-s">{{ relativeTime(r.at) }}</span>
            </button>
            <span class="tools">
              <button class="rv-icon-btn" type="button" title="Forget" @click="searches.forget(r.q)"><Icon name="close" /></button>
            </span>
          </div>
        </div>
        <p v-else class="rv-hint">Searches you run appear here.</p>
      </section>

      <section v-if="recentPosts.length" class="block">
        <div class="block-head">
          <h2 class="rv-heading rv-label">Recently viewed</h2>
          <RouterLink class="rv-small-btn" to="/history">History</RouterLink>
        </div>
        <div class="strip">
          <RouterLink
            v-for="p in recentPosts"
            :key="p.id"
            class="mini"
            :to="{ path: '/history', query: { post: String(p.id) } }"
            :title="`#${p.id}`"
            @contextmenu="onMiniMenu($event, p)"
          >
            <img v-if="p.previewUrl" :src="p.previewUrl" alt="" loading="lazy" decoding="async" />
          </RouterLink>
        </div>
      </section>
    </div>

    <p class="keys rv-hint">Press <kbd>?</kbd> for keyboard shortcuts · <kbd>/</kbd> to search · <kbd>Q</kbd> for the query assistant.</p>
  </div>
</template>

<style scoped>
.trends {
  display: grid;
  gap: 6px;
  margin: 0 0 18px;
}
.inbox {
  margin-bottom: 6px;
}
.inbox .block-head .rv-small-btn {
  text-decoration: none;
}
.trow {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}
.trow::-webkit-scrollbar {
  display: none;
}
.trow .rv-label {
  flex: none;
  min-width: 92px;
}
.trow .chip {
  flex: none;
  padding: 0 8px;
  cursor: pointer;
}
.trow .chip:hover {
  border-color: var(--text-3);
  background: var(--hover);
}
@media (pointer: coarse) {
  .trow .chip {
    height: 32px;
  }
  /* Room inside the scrolling row for the chips' tap areas (same layout). */
  .trow {
    padding-block: 4px;
    margin-block: -4px;
  }
}

.hero {
  position: relative;
  display: grid;
  gap: 12px;
  padding: 20px 0 22px;
  border-bottom: 1px solid var(--line);
}
/* The wordmark: the framed paw, then the name in lower case (the settling glyphs too). */
.name {
  display: flex;
  align-items: center;
  gap: 0.3em;
  margin: 0;
  font-size: 1.875rem;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: -0.01em;
  text-transform: lowercase;
}
.name .mark {
  width: 1.2em;
  height: 1.2em;
}
.tag {
  margin: -6px 0 6px;
}
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.quick .rv-btn {
  text-decoration: none;
}
/* minmax(0, …): a long one-line search must not widen its column past the screen. */
.cols {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 28px;
}
.rows .r.more {
  color: var(--text-2);
  text-decoration: none;
  font-size: 0.6875rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.strip {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}
.mini {
  aspect-ratio: 1;
  background: var(--panel);
  overflow: hidden;
  display: block;
}
.mini img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.mini:hover {
  outline: 1px solid var(--text);
  outline-offset: -1px;
}
.keys {
  margin-top: 18px;
}
kbd {
  font: inherit;
  color: var(--text);
  border: 1px solid var(--line-2);
  padding: 0 4px;
}
.rv-small-btn {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
@media (max-width: 760px) {
  .cols {
    grid-template-columns: minmax(0, 1fr);
  }
  .hide-s {
    display: none;
  }
}
/* No keyboard to speak of on touch screens. */
@media (hover: none), (pointer: coarse) {
  .keys {
    display: none;
  }
}
</style>
