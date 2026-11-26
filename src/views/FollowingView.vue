<script setup lang="ts">
import { vDecode } from '@/directives/decode'
import { computed, onActivated, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useRefresh } from '@/services/refresh'
import PostGrid from '@/components/PostGrid.vue'
import PageMore from '@/components/PageMore.vue'
import GridTools from '@/components/GridTools.vue'
import TagChips from '@/components/assistant/TagChips.vue'
import Icon from '@/components/Icon.vue'
import { useFollows } from '@/stores/follows'
import { useGallery } from '@/stores/gallery'
import { useSites } from '@/stores/sites'
import { useSettings } from '@/stores/settings'
import { useViewerNav } from '@/composables/viewerNav'
import { cachedFeed, effectiveQuery, searchFeed, type Feed } from '@/services/feed'
import { tooManyTerms } from '@/query/syntax'
import { useInbox } from '@/composables/inbox'
import InboxRows from '@/components/InboxRows.vue'

const route = useRoute()
const follows = useFollows()
const gallery = useGallery()
const sites = useSites()
const settings = useSettings()
const nav = useViewerNav()

/* One stream of everything followed that posts can be searched by: each tag as ~tag, each search as
   a group ~( … ), up to what one search takes (a couple of terms are left for the filters added to
   every search). A sorted search (order:) is not newest first and stays out, and so does one with
   its own ~ terms or groups (a ~ inside a group matches nothing). */
const streamParts = computed(() => {
  const parts: string[] = []
  let left = 0
  for (const f of follows.shown) {
    const search = follows.kindOf(f) === 'search'
    if (search && /(^|\s)-?order:|(^|\s)~|[()]/i.test(f.tag)) continue
    const part = search ? `~( ${f.tag} )` : `~${f.tag}`
    if (tooManyTerms([...parts, part, 'a', 'b'].join(' '))) {
      left++
      continue
    }
    parts.push(part)
  }
  return { parts, left }
})
const combined = computed(() => {
  const { parts } = streamParts.value
  if (!parts.length) return ''
  // One alone: as it is (a ~ alone, or a lone group, would be odd to show as the query).
  if (parts.length === 1) return parts[0].replace(/^~\(\s*|\s*\)$/g, '').replace(/^~/, '')
  return parts.join(' ')
})
const inbox = useInbox()
const feed = shallowRef<Feed | null>(null)
watch(
  () => [route.name, combined.value, sites.scope, settings.s.blockFlash, settings.s.defaultFilter] as const,
  ([name, q]) => {
    // Only on screen: kept alive while hidden, it registered its feed over the page on screen whenever
    // a tag was followed elsewhere (the viewer there then stepped through this list, or none).
    if (name !== 'following') return
    if (!q) {
      feed.value = null
      return
    }
    const opts = { pageSize: settings.s.pageSize, defaultFilter: settings.s.defaultFilter, blockFlash: settings.s.blockFlash }
    const f = cachedFeed(`following:${sites.scope}:${effectiveQuery(q, opts)}`, () => searchFeed(q, opts))
    feed.value = f
    gallery.setFeed(f)
    if (!f.posts.value.length && !f.done.value) void f.loadMore()
  },
  { immediate: true },
)
onActivated(() => feed.value && gallery.setFeed(feed.value))

const adding = ref<string[]>([])
/** Typed or pasted tags: all followed at once, and the field is clear for the next ones. */
function onAdd(tags: string[]) {
  follows.followMany(tags)
  adding.value = []
}
function markAll() {
  inbox.markAllSeen(feed.value?.posts.value[0]?.id)
}
// Pull down at the top: the stream again, and the counts checked (in the background: one request a tag).
useRefresh(() => {
  void follows.check(true)
  return feed.value?.reload()
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1 v-decode="'// Following'"></h1>
      <span class="readout"><b>{{ inbox.entries.value.length }}</b> followed<template v-if="inbox.total.value"> // <b>{{ inbox.total.value }}</b> new</template></span>
      <span class="grow"></span>
      <span v-if="follows.checking" class="readout">Checking {{ Math.round(follows.progress * 100) }}%</span>
      <button class="rv-btn rv-btn--sm" type="button" :disabled="follows.checking || !inbox.entries.value.length" @click="follows.check(true)"><Icon name="retry" />Check now</button>
      <button class="rv-btn rv-btn--sm" type="button" :disabled="!inbox.total.value" @click="markAll"><Icon name="check" />Mark all seen</button>
      <GridTools />
      <PageMore />
    </div>

    <div class="layout">
      <aside class="list">
        <div class="rv-field">
          <span class="rv-label">Follow a tag</span>
          <TagChips v-model:tags="adding" placeholder="Type a tag, Enter" label="Follow a tag" :commit-on-blur="false" @update:tags="onAdd" />
        </div>
        <InboxRows v-if="inbox.entries.value.length" :entries="inbox.entries.value" tools slim />
        <p class="rv-hint">Searches, artists and pools can be followed from their own pages (Follow, or a pool's bookmark). Checks run here, in this browser: when pawbs opens or comes back to the screen if the last is half an hour old, and with Check now. What a follow shows counts as seen once you leave its results.</p>
        <p v-if="streamParts.left" class="rv-hint warn">{{ streamParts.left }} {{ streamParts.left === 1 ? 'follow is' : 'follows are' }} not in the stream: one search takes at most 40 terms.</p>
      </aside>
      <section class="stream">
        <PostGrid
          v-if="feed"
          :posts="feed.posts.value"
          :loading="feed.loading.value"
          :done="feed.done.value"
          :error="feed.error.value"
          :href-for="nav.hrefFor"
          @open="nav.openPost"
          @more="feed.loadMore($event)"
          @retry="feed.loadMore()"
        />
        <div v-else class="state">
          <div class="rv-panel rv-brackets">
            <div class="rv-label">Nothing followed yet</div>
            <p class="msg">Follow tags, artists or searches to get one stream of their newest posts and a count of what is new since you last looked.</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* The phone: the title, the count and the page's "⋯" on the first row; Check now and Mark all seen
   share the row below, half each (big enough to tap). */
@media (max-width: 640px) {
  .page-head > .rv-btn {
    order: 2;
    /* (Too wide to share the first row: both go to the second.) */
    flex: 1 1 40%;
    justify-content: center;
  }
}
.layout {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.list {
  display: grid;
  gap: 12px;
  position: sticky;
  top: calc(var(--bar-h) + 56px);
  max-height: calc(100dvh - var(--bar-h) - 70px);
  overflow-y: auto;
}
.fresh {
  height: 20px;
  padding: 0 6px;
  font-size: 0.625rem;
  color: var(--bg);
  background: var(--text);
  border: 0;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  flex: none;
}
@media (pointer: coarse) {
  /* A tap area the height of its row (the button itself stays a 20px mark). */
  .fresh {
    position: relative;
  }
  .fresh::after {
    content: '';
    position: absolute;
    inset: -10px -6px;
  }
}
.r .sub {
  padding-right: 8px;
}
.msg {
  color: var(--text-2);
  margin: 0;
}
@media (max-width: 860px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .list {
    position: static;
    max-height: none;
  }
  .hide-s {
    display: none;
  }
}
</style>
