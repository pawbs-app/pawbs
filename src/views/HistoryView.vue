<script setup lang="ts">
import { vNewTab } from '@/directives/newTab'
import { vDecode } from '@/directives/decode'
import { computed, onActivated, onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import PostGrid from '@/components/PostGrid.vue'
import PageMore from '@/components/PageMore.vue'
import GridTools from '@/components/GridTools.vue'
import Icon from '@/components/Icon.vue'
import { useHistory } from '@/stores/history'
import { useSearches } from '@/stores/searches'
import { useGallery } from '@/stores/gallery'
import { useUi } from '@/stores/ui'
import { useSettings } from '@/stores/settings'
import { useViewerNav } from '@/composables/viewerNav'
import { refFeed, withoutFlash } from '@/services/feed'
import { relativeTime } from '@/utils/format'
import type { Post } from '@/api/types'
import { openMenu, type MenuEntry } from '@/services/contextMenu'
import type { SelectAction } from '@/stores/selection'
import { useQueryMenus } from '@/composables/queryMenus'

const router = useRouter()
const history = useHistory()
const searches = useSearches()
const gallery = useGallery()
const ui = useUi()
const nav = useViewerNav()
const settings = useSettings()

const posts = computed(() => withoutFlash(history.posts, settings.s.blockFlash))
const feed = refFeed('history', 'History', posts)
onMounted(() => gallery.setFeed(feed))
onActivated(() => gallery.setFeed(feed))
onBeforeUnmount(() => feed.stop())

const menus = useQueryMenus()
/** History's own entry on a thumbnail's menu. */
const historyEntries = (p: Post): MenuEntry[] => [{ label: 'Remove from history', icon: 'trash', run: () => history.remove(p.id) }]
const selectActions: SelectAction[] = [{ label: 'Remove the selected posts from history', icon: 'trash', danger: true, run: (posts) => posts.forEach((p) => history.remove(p.id)) }]
function onSearchMenu(e: MouseEvent, q: string) {
  openMenu(e, [...menus.searchEntries(q), 'sep', { label: 'Remove from history', icon: 'trash', run: () => searches.forget(q) }], q)
}

function clearViewed() {
  const keep = [...history.items]
  history.clear()
  ui.toast('Viewing history cleared', { action: { label: 'Undo', run: () => (history.items = keep) } })
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1 v-decode="'// History'"></h1>
      <span class="readout"><b>{{ history.posts.length }}</b> viewed // <b>{{ searches.recent.length }}</b> searches</span>
      <!-- Private session (Settings › Privacy): said where its effect would be missed. -->
      <RouterLink v-if="settings.s.pauseHistory" class="readout private" to="/settings/privacy" title="Nothing is added to the history while it is on">Private session on</RouterLink>
      <span class="grow"></span>
      <button class="rv-btn rv-btn--sm" type="button" :disabled="!history.items.length" @click="clearViewed"><Icon name="trash" />Clear viewed</button>
      <button class="rv-btn rv-btn--sm" type="button" :disabled="!searches.recent.length" @click="searches.clearRecent()"><Icon name="trash" />Clear searches</button>
      <GridTools />
      <PageMore />
    </div>
    <div v-if="searches.recent.length" class="searches">
      <span class="rv-label">Searches</span>
      <button
        v-for="r in searches.recent"
        :key="r.q"
        class="chip"
        type="button"
        v-new-tab="{ path: '/posts', query: { q: r.q } }"
        :title="relativeTime(r.at)"
        @click="router.push({ path: '/posts', query: { q: r.q } })"
        @contextmenu="onSearchMenu($event, r.q)"
      >
        <span class="t">{{ r.q }}</span>
      </button>
    </div>
    <PostGrid
        personal
      :posts="posts"
      :done="true"
      :href-for="nav.hrefFor"
      :end-note="false"
      empty-label="Nothing viewed yet"
      empty-message="Posts you open in the gallery are listed here, newest first, on this device only."
      :menu-extra="historyEntries"
      :select-actions="selectActions"
      @open="nav.openPost"
    />
  </div>
</template>

<style scoped>
.private {
  color: var(--warn);
  text-decoration: none;
}
.searches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-bottom: 12px;
}
.searches .rv-label {
  margin-right: 6px;
}
</style>
