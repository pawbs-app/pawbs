<script setup lang="ts">
/* One set: its posts (searched with set:<shortname>, so even a set of a million opens at once), its
   description, and what can be done with it: read it in the gallery, keep it in the library, save
   its files, and for the account's own sets, edit, delete and take posts out. */
import { vDecode } from '@/directives/decode'
import { computed, onActivated, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRefresh } from '@/services/refresh'
import PostGrid from '@/components/PostGrid.vue'
import PageMore from '@/components/PageMore.vue'
import GridTools from '@/components/GridTools.vue'
import BulkSaveDialog from '@/components/BulkSaveDialog.vue'
import StatePanel from '@/components/StatePanel.vue'
import Dialog from '@/components/Dialog.vue'
import SetEditDialog from '@/components/SetEditDialog.vue'
import Icon from '@/components/Icon.vue'
import { cachedFeed, searchFeed, type Feed } from '@/services/feed'
import { getSet } from '@/api/endpoints'
import type { Post, PostSet } from '@/api/types'
import type { MenuEntry } from '@/services/contextMenu'
import type { SelectAction } from '@/stores/selection'
import { useGallery } from '@/stores/gallery'
import { useSites } from '@/stores/sites'
import { useSettings } from '@/stores/settings'
import { useSetLibrary } from '@/stores/setLibrary'
import { useMySets } from '@/stores/mySets'
import { useUi } from '@/stores/ui'
import { forgetSet, knownSet, rememberSets } from '@/services/setCache'
import { useViewerNav } from '@/composables/viewerNav'
import { renderDText } from '@/utils/dtext'
import { relativeTime } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const gallery = useGallery()
const sites = useSites()
const settings = useSettings()
const library = useSetLibrary()
const mine = useMySets()
const ui = useUi()
const nav = useViewerNav()

const set = shallowRef<PostSet | null>(null)
const error = ref<string | null>(null)
const feed = shallowRef<Feed | null>(null)
const bulk = ref(false)
const editing = ref(false)
const confirmDelete = ref(false)
const deleting = ref(false)

/** The account's own (or maintained) set: it can be edited and emptied here. */
const isMine = computed(() => !!set.value && !!mine.byId(set.value.id))

function openFeed(s: PostSet, at: string) {
  const opts = { pageSize: settings.s.pageSize, defaultFilter: settings.s.defaultFilter, blockFlash: settings.s.blockFlash }
  const q = `set:${s.shortname}`
  const f = cachedFeed(`set:${sites.scope}:${s.id}:${s.shortname}:${s.updatedAt}:${settings.s.blockFlash}:${settings.s.defaultFilter}`, () => searchFeed(q, opts))
  feed.value = f
  gallery.setFeed(f, at)
  if (!f.posts.value.length && !f.done.value) void f.loadMore()
}

/** Counted up by Retry: the page loads again. */
const again = ref(0)
watch(
  () => [route.name, route.params.id, sites.scope, settings.s.blockFlash, settings.s.defaultFilter, again.value] as const,
  async ([name, id]) => {
    if (name !== 'set') return
    const sid = Number(id)
    const at = route.path
    error.value = null
    // Known from a list (or the account's sets): shown at once, checked with the site behind.
    const quick = knownSet(sid) ?? mine.byId(sid)
    set.value = quick ?? null
    feed.value = null
    if (quick) openFeed(quick, at)
    if (mine.available) void mine.load()
    try {
      const s = await getSet(sid)
      if (route.path !== at) return
      if (!s) throw new Error('This set does not exist, or it is private.')
      rememberSets([s])
      library.refresh([s])
      const changed = !quick || quick.shortname !== s.shortname || quick.updatedAt !== s.updatedAt
      set.value = s
      if (changed) openFeed(s, at)
    } catch (e) {
      if (route.path !== at) return
      if (!quick) error.value = (e as Error).message
    }
  },
  { immediate: true },
)
onActivated(() => feed.value && gallery.setFeed(feed.value))

const description = computed(() => (set.value?.description ? renderDText(set.value.description, sites.origin) : ''))
function onDescClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a[data-route]') as HTMLAnchorElement | null
  if (a) {
    e.preventDefault()
    void router.push(a.dataset.route!)
  }
}
function read() {
  const first = feed.value?.posts.value[0]
  if (first) nav.openPost(first)
}
function toggleSave() {
  if (!set.value) return
  const on = library.toggle(set.value)
  ui.toast(on ? 'Saved to the set library' : 'Removed from the set library', { tone: on ? 'ok' : undefined })
}
function addLoaded() {
  if (feed.value && set.value) ui.addToSet = { posts: feed.value.posts.value, title: set.value.name }
}
function onSaved(s: PostSet) {
  editing.value = false
  const before = set.value
  set.value = { ...s, updatedAt: new Date().toISOString() }
  rememberSets([set.value])
  library.refresh([set.value])
  if (before?.shortname !== s.shortname) openFeed(set.value, route.path)
  ui.toast('Set saved', { tone: 'ok' })
}
async function removeSet() {
  const s = set.value
  if (!s || deleting.value) return
  deleting.value = true
  try {
    await mine.remove(s.id)
    forgetSet(s.id)
    library.remove(s.id)
    confirmDelete.value = false
    ui.toast(`Set ${s.name} deleted`)
    void router.replace({ path: '/sets', query: { tab: 'mine' } })
  } catch (e) {
    ui.toast((e as Error).message, { tone: 'bad' })
  } finally {
    deleting.value = false
  }
}

/** Taking a post out of one of the account's sets, from its menu here. */
async function takeOut(p: Post) {
  const s = set.value
  if (!s) return
  try {
    await mine.take(s.id, [p.id])
    if (feed.value) feed.value.posts.value = feed.value.posts.value.filter((x) => x.id !== p.id)
    set.value = { ...s, postCount: Math.max(0, s.postCount - 1) }
    ui.toast(`Removed from ${s.name}`, { action: { label: 'Undo', run: () => void mine.add(s.id, [p.id]).then(() => feed.value?.reload()) } })
  } catch (e) {
    ui.toast((e as Error).message, { tone: 'bad' })
  }
}
const menuExtra = (p: Post): MenuEntry[] => (isMine.value ? [{ label: 'Remove from this set', icon: 'minus', danger: true, run: () => takeOut(p) }] : [])
const selectActions = computed<SelectAction[]>(() =>
  isMine.value
    ? [
        {
          label: 'Remove the selected posts from this set',
          icon: 'minus',
          danger: true,
          run: async (posts) => {
            const s = set.value
            if (!s) return
            const ids = posts.map((p) => p.id)
            try {
              const n = await mine.take(s.id, ids)
              const gone = new Set(ids)
              if (feed.value) feed.value.posts.value = feed.value.posts.value.filter((x) => !gone.has(x.id))
              set.value = { ...s, postCount: Math.max(0, s.postCount - n) }
              ui.toast(`${n} post${n === 1 ? '' : 's'} removed from ${s.name}`)
            } catch (e) {
              ui.toast((e as Error).message, { tone: 'bad' })
            }
          },
        },
      ]
    : [],
)
// Pull down at the top: the set's posts again.
useRefresh(() => feed.value?.reload())
</script>

<template>
  <div class="page">
    <div v-if="error" class="state"><StatePanel label="Set // not available" :message="error" alert><template #actions><button class="rv-btn" type="button" @click="again++">Retry</button></template></StatePanel></div>
    <template v-else-if="set">
      <div class="page-head">
        <RouterLink to="/sets" class="rv-icon-btn" title="All sets"><Icon name="chevron-left" /></RouterLink>
        <h1 v-decode="'// ' + set.name" class="ellipsis grow" :class="{ 'wide-title': set.name.length > 12 }" :title="set.name"></h1>
        <span class="readout hide-s"><b>{{ set.postCount }}</b> posts // {{ set.isPublic ? 'public' : 'private' }}<template v-if="set.updatedAt"> // updated {{ relativeTime(set.updatedAt) }}</template></span>
        <button class="rv-btn rv-btn--sm rv-btn--primary" type="button" :disabled="!feed?.posts.value.length" @click="read"><Icon name="play" />Read</button>
        <button data-keep
          class="rv-icon-btn"
          :class="{ 'is-active': library.isSaved(set.id) }"
          type="button"
          :aria-pressed="library.isSaved(set.id)"
          :title="library.isSaved(set.id) ? 'Remove from the set library' : 'Save to the set library'"
          @click="toggleSave"
        >
          <Icon :name="library.isSaved(set.id) ? 'bookmark-on' : 'bookmark'" />
        </button>
        <template v-if="isMine">
          <button class="rv-icon-btn" type="button" title="Edit the set…" @click="editing = true"><Icon name="edit" /></button>
          <button class="rv-icon-btn" type="button" title="Delete the set…" @click="confirmDelete = true"><Icon name="trash" /></button>
        </template>
        <button class="rv-icon-btn" type="button" title="Add the loaded posts to a collection…" :disabled="!feed?.posts.value.length" @click="addLoaded">
          <Icon name="collection" />
        </button>
        <button class="rv-icon-btn" type="button" title="Save the loaded posts…" :disabled="!feed?.posts.value.length" @click="bulk = true"><Icon name="download" /></button>
        <a v-if="sites.active" class="rv-icon-btn" :href="`${sites.active.url}/post_sets/${set.id}`" target="_blank" rel="noopener noreferrer" :title="`Open on ${sites.active.name}`"><Icon name="external" /></a>
        <GridTools />
        <PageMore />
      </div>
      <div v-if="description" class="dtext sdesc" @click="onDescClick" v-html="description"></div>
      <p v-if="feed && feed.done.value && feed.posts.value.length < set.postCount" class="rv-hint note">
        {{ set.postCount - feed.posts.value.length }} of its posts are not shown: hidden from guests or by this site, or filtered out (default filter, Flash).
      </p>
      <PostGrid
        v-if="feed"
        :posts="feed.posts.value"
        :loading="feed.loading.value"
        :done="feed.done.value"
        :error="feed.error.value"
        :href-for="nav.hrefFor"
        :menu-extra="menuExtra"
        :select-actions="selectActions"
        empty-label="Empty set"
        @open="nav.openPost"
        @more="feed.loadMore()"
        @retry="feed.loadMore()"
      />
      <BulkSaveDialog v-if="bulk && feed" :posts="feed.posts.value" :title="set.name" @close="bulk = false" />
      <SetEditDialog v-if="editing" :set="set" @close="editing = false" @saved="onSaved" />
      <Dialog v-if="confirmDelete" title="Delete set" @close="!deleting && (confirmDelete = false)">
        <p>Delete {{ set.name }} ({{ set.postCount }} posts) from your account? The posts stay on the site; only the set goes. This cannot be undone.</p>
        <template #footer>
          <span class="rv-spacer"></span>
          <button class="rv-btn" type="button" :disabled="deleting" @click="confirmDelete = false">Cancel</button>
          <button class="rv-btn rv-btn--danger-primary" type="button" :disabled="deleting" @click="removeSet"><Icon name="trash" />{{ deleting ? 'Deleting…' : 'Delete' }}</button>
        </template>
      </Dialog>
    </template>
    <div v-else class="state"><StatePanel label="Loading set" loading /></div>
  </div>
</template>

<style scoped>
.sdesc {
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
