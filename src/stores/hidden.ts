import { defineStore } from 'pinia'
import { computed } from 'vue'
import { persistentScoped } from './persist'
import { useSites } from './sites'
import type { Post } from '@/api/types'

export interface HiddenPost {
  i: number
  /** Its thumbnail, for the list to bring posts back from. */
  p: string | null
  /** Its rating (kept since 1.14.12): on e926 the list shows the thumbnails of safe posts only. */
  r?: string
  at: number
}

const KEEP = 10000

/* "Not interested": posts put out of sight for good, per site, one by one (the blacklist hides by
   tags). They leave searches, feeds and the gallery; lists of one's own (favourites, collections,
   history) still show them. Settings › Blacklist lists them to bring any back. */
export const useHidden = defineStore('hidden', () => {
  const sites = useSites()
  const scope = computed(() => sites.dataScope) // e621 and e926: one set (stores/sites)
  /** Newest first. */
  const list = persistentScoped<HiddenPost[]>(scope, 'hidden', () => [])
  const ids = computed(() => new Set(list.value.map((h) => h.i)))
  const count = computed(() => list.value.length)
  const has = (id: number) => ids.value.has(id)

  /** Hide posts; returns the ones newly hidden (for an undo). */
  function hide(posts: Post[]): number[] {
    const now = Date.now()
    const seen = new Set(ids.value)
    const fresh: HiddenPost[] = []
    for (const p of posts) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      fresh.push({ i: p.id, p: p.previewUrl ?? p.sampleUrl, r: p.rating, at: now - fresh.length })
    }
    if (fresh.length) list.value = [...fresh, ...list.value].slice(0, KEEP)
    return fresh.map((h) => h.i)
  }
  function unhide(postIds: number[]) {
    const out = new Set(postIds)
    if (list.value.some((h) => out.has(h.i))) list.value = list.value.filter((h) => !out.has(h.i))
  }
  /** Put entries back as they were (an undo). */
  function restore(entries: HiddenPost[]) {
    const have = ids.value
    const back = entries.filter((h) => !have.has(h.i))
    if (back.length) list.value = [...back, ...list.value].sort((a, b) => b.at - a.at)
  }
  function clear() {
    list.value = []
  }

  return { list, ids, count, has, hide, unhide, restore, clear }
})
