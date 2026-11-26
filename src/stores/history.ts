import { defineStore } from 'pinia'
import { computed, shallowRef, watch } from 'vue'
import { persistentScoped } from './persist'
import { useSites } from './sites'
import { useSettings } from './settings'
import { fromSnapshot, toSnapshot, type Snapshot } from '@/api/snapshot'
import type { Post } from '@/api/types'

const MAX = 300
/** Posts kept as seen (ids only: a few kilobytes), for dimming or hiding them (Settings › Browsing). */
const SEEN_MAX = 5000

/** Posts opened in the viewer, newest first. Tags are left out to keep storage small. */
export const useHistory = defineStore('history', () => {
  const sites = useSites()
  const scope = computed(() => sites.dataScope) // e621 and e926: one set (stores/sites)
  const items = persistentScoped<Snapshot[]>(scope, 'viewed', () => [])
  const posts = shallowRef<Post[]>([])
  // (On e926, only the safe ones of a history shared with e621.)
  watch([items, () => sites.sfw], ([list]) => (posts.value = list.filter((s) => sites.shows(s.r)).map(fromSnapshot)), { immediate: true, deep: true })

  /* Seen: every post opened in the gallery, newest first, kept longer than the history itself. A list
     hides only the posts seen before it was entered (`before`, set by markListStart): one opened
     while going through it stays, dimmed, or the list would shift under the gallery. */
  const seen = persistentScoped<number[]>(scope, 'seen', () => [])
  const seenSet = computed(() => new Set(seen.value))
  const before = shallowRef(new Set<number>(seen.value))
  /** A new list is shown (another search, another page): what was seen up to now is "before". */
  function markListStart() {
    before.value = new Set(seen.value)
  }
  watch(scope, markListStart)

  function record(post: Post) {
    // Private session (Settings › Privacy): nothing kept.
    if (useSettings().s.pauseHistory) return
    if (seen.value[0] !== post.id) seen.value = [post.id, ...seen.value.filter((i) => i !== post.id)].slice(0, SEEN_MAX)
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
  return { items, posts, record, remove, clear, seen, seenSet, before, markListStart }
})
