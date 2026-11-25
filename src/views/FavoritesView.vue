<script setup lang="ts">
import { vNewTab } from '@/directives/newTab'
import { vDecode } from '@/directives/decode'
import { computed, onActivated, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import PostGrid from '@/components/PostGrid.vue'
import PageMore from '@/components/PageMore.vue'
import GridTools from '@/components/GridTools.vue'
import BulkSaveDialog from '@/components/BulkSaveDialog.vue'
import Icon from '@/components/Icon.vue'
import { useFavorites } from '@/stores/favorites'
import { useSites } from '@/stores/sites'
import { useGallery } from '@/stores/gallery'
import { useUi } from '@/stores/ui'
import { useViewerNav } from '@/composables/viewerNav'
import { refFeed, withoutFlash } from '@/services/feed'
import { useSettings } from '@/stores/settings'
import { searchPosts } from '@/api/endpoints'
import { Priority } from '@/api/client'
import { filterLocal, sortLocal, type LocalSort } from '@/query/localFilter'
import { saveJson } from '@/services/download'
import type { Post } from '@/api/types'

const router = useRouter()
const favorites = useFavorites()
const sites = useSites()
const gallery = useGallery()
const ui = useUi()
const nav = useViewerNav()
const settings = useSettings()

const filter = ref('')
const sort = ref<LocalSort>('added')
const bulk = ref(false)

/* Local filter in the search language's simple form: tags, -tags, rating:, type:. */
const list = computed<Post[]>(() => sortLocal(filterLocal(withoutFlash(favorites.posts, settings.s.blockFlash), filter.value), sort.value))

const feed = refFeed('favorites', 'Favourites', list)
onMounted(() => gallery.setFeed(feed))
onActivated(() => gallery.setFeed(feed))
onBeforeUnmount(() => feed.stop())

// Import the account's favourites (by searching fav:name page by page).
const importing = ref(false)
const imported = ref(0)
async function importAccount() {
  const name = sites.active?.username
  if (!name) return
  importing.value = true
  imported.value = 0
  let added = 0
  let last: number | null = null
  const site = sites.scope
  try {
    for (let page = 0; page < 40; page++) {
      const posts = await searchPosts(`fav:${name}`, { limit: 320, page: last ? `b${last}` : undefined, priority: Priority.Background, ttl: 0 })
      // Another site chosen meanwhile: its favourites are not this account's, and the next page
      // would be asked of it.
      if (sites.scope !== site) return
      if (!posts.length) break
      added += favorites.addMany(posts)
      imported.value += posts.length
      last = posts[posts.length - 1].id
      if (posts.length < 320) break
    }
    ui.toast(`${added} posts added from ${name}’s favourites (${imported.value} read)`, { tone: 'ok' })
  } catch (e) {
    ui.toast((e as Error).message, { tone: 'bad' })
  } finally {
    importing.value = false
  }
}
function exportJson() {
  saveJson({ app: 'NgGallery', kind: 'favorites', site: sites.active?.url, exportedAt: new Date().toISOString(), items: favorites.items }, 'pawbs-favourites.json')
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1 v-decode="'// Favourites'"></h1>
      <span class="readout"><b>{{ list.length }}</b><template v-if="list.length !== favorites.count"> / {{ favorites.count }}</template> posts</span>
      <input v-model="filter" class="rv-input filter" type="search" placeholder="Filter: tag -tag rating:s" aria-label="Filter favourites" />
      <select v-model="sort" class="rv-select sort" aria-label="Sort">
        <option value="added">Recently saved</option>
        <option value="added_asc">First saved</option>
        <option value="id">Newest posts</option>
        <option value="score">Score</option>
      </select>
      <span class="grow"></span>
      <button v-if="sites.hasAccount" class="rv-btn rv-btn--sm" type="button" :disabled="importing" :title="`Copy the favourites of ${sites.active?.username} on the site into this list`" @click="importAccount">
        <Icon name="download" />{{ importing ? `Importing ${imported}…` : 'Import from account' }}
      </button>
      <button v-if="sites.hasAccount" v-new-tab="{ path: '/posts', query: { q: `fav:${sites.active!.username}` } }" class="rv-icon-btn" type="button" title="Search the account’s favourites on the site" @click="router.push({ path: '/posts', query: { q: `fav:${sites.active!.username}` } })"><Icon name="search" /></button>
      <button class="rv-icon-btn" type="button" title="Add these favourites to a collection…" :disabled="!list.length" @click="ui.addToSet = { posts: list, title: 'favourites' }"><Icon name="collection" /></button>
      <button class="rv-icon-btn" type="button" title="Save these posts…" :disabled="!list.length" @click="bulk = true"><Icon name="folder" /></button>
      <button class="rv-icon-btn" type="button" title="Export as JSON" :disabled="!favorites.count" @click="exportJson"><Icon name="list" /></button>
      <GridTools />
      <PageMore />
    </div>
    <PostGrid
        personal
      :posts="list"
      :done="true"
      :href-for="nav.hrefFor"
      :end-note="false"
      :empty-label="filter ? 'No match' : 'No favourites yet'"
      :empty-message="filter ? 'No saved post matches this filter.' : 'Save a post with the bookmark button in the viewer (or press S). Favourites stay in this browser.'"
      @open="nav.openPost"
    />
    <BulkSaveDialog v-if="bulk" :posts="list" title="favourites" @close="bulk = false" />
  </div>
</template>

<style scoped>
.filter {
  width: 240px;
  height: 26px;
}
.sort {
  width: auto;
  height: 26px;
}
@media (max-width: 640px) {
  .filter {
    width: 100%;
    order: 10;
  }
}
</style>
