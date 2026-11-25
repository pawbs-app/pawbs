import { defineStore } from 'pinia'
import { computed, shallowRef, watch } from 'vue'
import { persistentScoped } from './persist'
import { useSites } from './sites'
import { fromSnapshot, toSnapshot, type Snapshot } from '@/api/snapshot'
import type { Post } from '@/api/types'

const MAX = 300

/** Posts opened in the viewer, newest first. Tags are left out to keep storage small. */
export const useHistory = defineStore('history', () => {
  const sites = useSites()
  const scope = computed(() => sites.dataScope) // e621 and e926: one set (stores/sites)
  const items = persistentScoped<Snapshot[]>(scope, 'viewed', () => [])
  const posts = shallowRef<Post[]>([])
  // (On e926, only the safe ones of a history shared with e621.)
  watch([items, () => sites.sfw], ([list]) => (posts.value = list.filter((s) => sites.shows(s.r)).map(fromSnapshot)), { immediate: true, deep: true })

  function record(post: Post) {
    if (items.value[0]?.i === post.id) return
    const snap = toSnapshot(post, false)
    snap.a = Date.now()
    items.value = [snap, ...items.value.filter((s) => s.i !== post.id)].slice(0, MAX)
  }
  function remove(id: number) {
    items.value = items.value.filter((s) => s.i !== id)
  }
  function clear() {
    items.value = []
  }
  return { items, posts, record, remove, clear }
})
