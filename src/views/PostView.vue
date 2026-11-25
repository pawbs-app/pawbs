<script setup lang="ts">
/* A link to one post: shows it with its family (parent and children) and opens it in the gallery. */
import { vDecode } from '@/directives/decode'
import { onActivated, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PostGrid from '@/components/PostGrid.vue'
import StatePanel from '@/components/StatePanel.vue'
import { createFeed, type Feed } from '@/services/feed'
import { getPost, searchPosts } from '@/api/endpoints'
import { useGallery } from '@/stores/gallery'
import { useViewerNav } from '@/composables/viewerNav'

const route = useRoute()
const router = useRouter()
const gallery = useGallery()
const nav = useViewerNav()
const feed = shallowRef<Feed | null>(null)
const error = ref<string | null>(null)

/** Counted up by Retry: the post is asked for again. */
const again = ref(0)
watch(
  () => [route.name, route.params.id, again.value] as const,
  async ([name, id]) => {
    if (name !== 'post') return
    const pid = Number(id)
    const at = route.path
    error.value = null
    try {
      const p = await getPost(pid)
      // Left meanwhile: nothing here is for the page on screen (its feed, its query) any more.
      if (route.path !== at) return
      if (!p) throw new Error('This post does not exist or is hidden from guests.')
      const f = createFeed(`post:${pid}`, `#${pid}`, async () => {
        const family = p.parentId || p.children.length ? await searchPosts(`~id:${p.parentId ?? p.id} ~parent:${p.parentId ?? p.id} status:any order:id_asc`, { limit: 100 }).catch(() => []) : []
        const list = family.some((x) => x.id === p.id) ? family : [p, ...family]
        return { posts: list, done: true }
      })
      feed.value = f
      gallery.setFeed(f, at)
      await f.loadMore()
      if (route.path === at && !route.query.post) router.replace({ path: route.path, query: { post: String(pid) } })
    } catch (e) {
      if (route.path === at) error.value = (e as Error).message
    }
  },
  { immediate: true },
)
onActivated(() => feed.value && gallery.setFeed(feed.value))
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1 v-decode="`// Post #${route.params.id}`"></h1>
      <span v-if="feed && feed.posts.value.length > 1" class="readout">with <b>{{ feed.posts.value.length - 1 }}</b> related</span>
    </div>
    <div v-if="error" class="state"><StatePanel :label="`Post #${route.params.id} // not available`" :message="error" alert><template #actions><button class="rv-btn" type="button" @click="again++">Retry</button></template></StatePanel></div>
    <PostGrid v-else-if="feed" :posts="feed.posts.value" :loading="feed.loading.value" :done="feed.done.value" :href-for="nav.hrefFor" :end-note="false" @open="nav.openPost" />
  </div>
</template>
