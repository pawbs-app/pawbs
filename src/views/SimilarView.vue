<script setup lang="ts">
/* Posts whose picture the site finds close to one post's: other versions, edits, higher resolutions,
   re-uploads. Closest first; the gallery steps through them. */
import { vNewTab } from '@/directives/newTab'
import { vDecode } from '@/directives/decode'
import { computed, onActivated, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useRefresh } from '@/services/refresh'
import PostGrid from '@/components/PostGrid.vue'
import PageMore from '@/components/PageMore.vue'
import GridTools from '@/components/GridTools.vue'
import StatePanel from '@/components/StatePanel.vue'
import Icon from '@/components/Icon.vue'
import { createFeed, withoutFlash, type Feed } from '@/services/feed'
import { getSimilarPosts } from '@/api/endpoints'
import type { SimilarPost } from '@/api/types'
import { useGallery } from '@/stores/gallery'
import { useSettings } from '@/stores/settings'
import { useSites } from '@/stores/sites'
import { useViewerNav } from '@/composables/viewerNav'

/** From this likeness up, usually the same picture (another size, a fix, a re-upload). */
const CLOSE = 85

const route = useRoute()
const gallery = useGallery()
const settings = useSettings()
const sites = useSites()
const nav = useViewerNav()

const sourceId = computed(() => Number(route.params.id) || 0)
const results = shallowRef<SimilarPost[]>([])
const feed = shallowRef<Feed | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)

/** Counted up by Retry (and by pulling down): the comparison is asked for again. */
const again = ref(0)
watch(
  () => [route.name, sourceId.value, sites.scope, settings.s.blockFlash, again.value] as const,
  async ([name, id, , block]) => {
    if (name !== 'similar') return
    // (No such post number: said as for a post the site does not have, not as "nothing similar".)
    if (!id) {
      results.value = []
      feed.value = null
      error.value = 'Not found on the site'
      return
    }
    const at = route.path
    loading.value = true
    error.value = null
    results.value = []
    feed.value = null
    try {
      const found = await getSimilarPosts(id)
      if (route.path !== at) return
      results.value = found
      const posts = withoutFlash(
        found.map((r) => r.post),
        block,
      )
      const f = createFeed(`similar:${id}`, `Similar to #${id}`, async () => ({ posts, done: true }))
      feed.value = f
      gallery.setFeed(f, at)
      void f.loadMore()
    } catch (e) {
      if (route.path === at) error.value = (e as Error).message
    } finally {
      if (route.path === at) loading.value = false
    }
  },
  { immediate: true },
)
onActivated(() => feed.value && gallery.setFeed(feed.value))

const close = computed(() => results.value.filter((r) => r.score >= CLOSE).length)
const best = computed(() => (results.value[0] ? Math.round(results.value[0].score) : 0))
// Pull down at the top: the comparison again.
useRefresh(() => void again.value++)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1 v-decode="`// Similar to #${sourceId}`" class="ellipsis grow"></h1>
      <span v-if="results.length" class="readout hide-s">
        <b>{{ results.length }}</b> found // <b>{{ close }}</b> close <span class="faint">(≥ {{ CLOSE }} %)</span> // best <b>{{ best }} %</b>
      </span>
      <button v-new-tab="`/post/${sourceId}`" class="rv-btn rv-btn--sm" type="button" title="Open the post these are compared with" @click="nav.openPost(sourceId)"><Icon name="eye" />#{{ sourceId }}</button>
      <GridTools />
      <PageMore />
    </div>
    <p v-if="results.length" class="rv-hint note">Closest first. {{ CLOSE }} % and above is usually the same picture (another size, a correction, a re-upload); lower are look-alikes.</p>
    <div v-if="error" class="state"><StatePanel label="Similar pictures // not available" :message="error" alert><template #actions><button class="rv-btn" type="button" @click="again++">Retry</button></template></StatePanel></div>
    <div v-else-if="loading" class="state"><StatePanel label="Comparing pictures" loading /></div>
    <div v-else-if="!results.length" class="state"><StatePanel label="Nothing similar" message="The site found no other post with a picture close to this one." /></div>
    <PostGrid
      v-else-if="feed"
      :posts="feed.posts.value"
      :loading="feed.loading.value"
      :done="feed.done.value"
      :error="feed.error.value"
      :href-for="nav.hrefFor"
      :end-note="false"
      empty-label="Nothing similar"
      @open="nav.openPost"
      @more="feed.loadMore()"
      @retry="feed.loadMore()"
    />
  </div>
</template>

<style scoped>
.note {
  margin: -4px 0 10px;
}
@media (max-width: 760px) {
  .hide-s {
    display: none;
  }
}
</style>
