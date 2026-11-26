<script setup lang="ts">
/* One collection (kept in this browser): its posts, filtered and sorted like favourites, read in the
   gallery, saved as files, put in other collections or sets; renamed, deleted, posts taken out. */
import { vDecode } from '@/directives/decode'
import { computed, onActivated, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PostGrid from '@/components/PostGrid.vue'
import PageMore from '@/components/PageMore.vue'
import GridTools from '@/components/GridTools.vue'
import BulkSaveDialog from '@/components/BulkSaveDialog.vue'
import { DOWNLOADS } from '@/features'
import StatePanel from '@/components/StatePanel.vue'
import CollectionEditDialog from '@/components/CollectionEditDialog.vue'
import Icon from '@/components/Icon.vue'
import type { Post } from '@/api/types'
import type { MenuEntry } from '@/services/contextMenu'
import type { SelectAction } from '@/stores/selection'
import { refFeed, withoutFlash } from '@/services/feed'
import { useCollections } from '@/stores/collections'
import { useGallery } from '@/stores/gallery'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'
import { useViewerNav } from '@/composables/viewerNav'
import { filterLocal, sortLocal, type LocalSort } from '@/query/localFilter'
import { relativeTime } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const store = useCollections()
const gallery = useGallery()
const settings = useSettings()
const ui = useUi()
const nav = useViewerNav()

// The collection of the route (kept while the page is cached under another route).
const id = ref(String(route.params.id ?? ''))
watch(
  () => [route.name, route.params.id] as const,
  ([name, pid]) => {
    if (name === 'collection' && pid) {
      if (id.value !== String(pid)) {
        filter.value = ''
        sort.value = 'added'
      }
      id.value = String(pid)
      gallery.setFeed(feed, route.path)
    }
  },
)
const c = computed(() => store.byId(id.value))

const filter = ref('')
const sort = ref<LocalSort>('added')
const all = computed<Post[]>(() => (c.value ? withoutFlash(store.postsOf(c.value), settings.s.blockFlash) : []))
const list = computed<Post[]>(() => sortLocal(filterLocal(all.value, filter.value), sort.value))

const feed = refFeed('collection', 'Collection', list)
gallery.setFeed(feed, route.path)
onActivated(() => route.name === 'collection' && gallery.setFeed(feed, route.path))
onBeforeUnmount(() => feed.stop())

const bulk = ref(false)
const editing = ref(false)

function read() {
  if (list.value[0]) nav.openPost(list.value[0])
}
function removeCollection() {
  const cur = c.value
  if (!cur) return
  const gone = store.remove(cur.id)
  if (!gone) return
  void router.replace({ path: '/sets', query: { tab: 'collections' } })
  ui.toast(`Collection ${cur.name} deleted`, {
    action: {
      label: 'Undo',
      run: () => {
        store.restore(gone.c, gone.at)
        void router.push(`/collections/${gone.c.id}`)
      },
    },
  })
}
function takeOut(p: Post) {
  const cur = c.value
  if (!cur) return
  const snaps = store.take(cur.id, [p.id])
  if (snaps.length) ui.toast(`Removed from ${cur.name}`, { action: { label: 'Undo', run: () => store.putBack(cur.id, snaps) } })
}
const menuExtra = (p: Post): MenuEntry[] => [{ label: 'Remove from this collection', icon: 'minus', danger: true, run: () => takeOut(p) }]
const selectActions: SelectAction[] = [
  {
    label: 'Remove the selected posts from this collection',
    icon: 'minus',
    danger: true,
    run: (posts) => {
      const cur = c.value
      if (!cur) return
      const snaps = store.take(cur.id, posts.map((p) => p.id))
      if (snaps.length) ui.toast(`${snaps.length} post${snaps.length === 1 ? '' : 's'} removed from ${cur.name}`, { action: { label: 'Undo', run: () => store.putBack(cur.id, snaps) } })
    },
  },
]
</script>

<template>
  <div class="page">
    <template v-if="c">
      <div class="page-head">
        <RouterLink :to="{ path: '/sets', query: { tab: 'collections' } }" class="rv-icon-btn" title="All collections"><Icon name="chevron-left" /></RouterLink>
        <h1 v-decode="'// ' + c.name" class="ellipsis" :class="{ 'wide-title': c.name.length > 12 }" :title="c.name"></h1>
        <span class="readout"><b>{{ list.length }}</b><template v-if="list.length !== c.items.length"> / {{ c.items.length }}</template> posts<span class="hide-s"> // updated {{ relativeTime(new Date(c.updatedAt).toISOString()) }}</span></span>
        <input v-model="filter" class="rv-input filter" type="search" placeholder="Filter: tag -tag rating:s" aria-label="Filter the collection" />
        <select v-model="sort" class="rv-select sort" aria-label="Sort">
          <option value="added">Recently added</option>
          <option value="added_asc">First added</option>
          <option value="id">Newest posts</option>
          <option value="score">Score</option>
        </select>
        <span class="grow"></span>
        <button class="rv-btn rv-btn--sm rv-btn--primary" type="button" :disabled="!list.length" @click="read"><Icon name="play" />Read</button>
        <button class="rv-icon-btn" type="button" title="Edit the collection…" @click="editing = true"><Icon name="edit" /></button>
        <button class="rv-icon-btn" type="button" title="Delete the collection" @click="removeCollection"><Icon name="trash" /></button>
        <button class="rv-icon-btn" type="button" title="Add these posts to another collection or set…" :disabled="!list.length" @click="ui.addToSet = { posts: list, title: c.name }"><Icon name="collection" /></button>
        <button v-if="DOWNLOADS" class="rv-icon-btn" type="button" title="Save these posts…" :disabled="!list.length" @click="bulk = true"><Icon name="download" /></button>
        <GridTools />
        <PageMore />
      </div>
      <p v-if="c.description" class="cdesc rv-selectable">{{ c.description }}</p>
      <PostGrid
        personal
        :posts="list"
        :done="true"
        :href-for="nav.hrefFor"
        :end-note="false"
        :menu-extra="menuExtra"
        :select-actions="selectActions"
        :empty-label="filter ? 'No match' : 'Empty collection'"
        :empty-message="filter ? 'No post of this collection matches the filter.' : 'Add posts from their menu (right-click or long press › Add to collection…), or all the posts of a page with its collection button.'"
        @open="nav.openPost"
      />
      <BulkSaveDialog v-if="bulk" :posts="list" :title="c.name" @close="bulk = false" />
      <CollectionEditDialog v-if="editing" :collection="c" @close="editing = false" @saved="editing = false" />
    </template>
    <div v-else class="state">
      <StatePanel label="Collection // not found" message="This collection is not in this browser (deleted, or kept for another site).">
        <template #actions><RouterLink class="rv-btn rv-btn--primary" :to="{ path: '/sets', query: { tab: 'collections' } }">All collections</RouterLink></template>
      </StatePanel>
    </div>
  </div>
</template>

<style scoped>
h1 {
  min-width: 0;
  max-width: 40ch;
}
.filter {
  width: 220px;
  height: 26px;
}
.sort {
  width: auto;
  height: 26px;
}
.cdesc {
  margin: 0 0 12px;
  max-height: 9em;
  overflow-y: auto;
  white-space: pre-line;
  color: var(--text-2);
}
.page-head a.rv-icon-btn {
  text-decoration: none;
}
@media (max-width: 760px) {
  .hide-s {
    display: none;
  }
}
@media (max-width: 640px) {
  .filter {
    width: 100%;
    order: 10;
  }
}
</style>
