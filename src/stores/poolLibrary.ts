import { defineStore } from 'pinia'
import { computed } from 'vue'
import { persistentScoped } from './persist'
import { useSites } from './sites'
import type { Pool } from '@/api/types'
import { searchPools } from '@/api/endpoints'

export interface SavedPool {
  id: number
  name: string
  category: string
  postCount: number
  /** The pool's first post, for its cover. */
  coverId: number | null
  isActive: boolean
  updatedAt: string
  savedAt: number
  /** Post count when the pool was last opened: anything above counts as new pages. */
  seenCount: number
  /** When its page count was last asked for (the Following checks, stores/follows). */
  checkedAt?: number
}

/* The pool library: pools kept in this browser, per site. The site's API can favourite posts but
   not pools, and favouriting every page of a pool would only bury them among single posts. */
export const usePoolLibrary = defineStore('poolLibrary', () => {
  const sites = useSites()
  const scope = computed(() => sites.dataScope) // e621 and e926: one set (stores/sites)
  const list = persistentScoped<SavedPool[]>(scope, 'pool-library', () => [])

  const ids = computed(() => new Set(list.value.map((p) => p.id)))
  const count = computed(() => list.value.length)
  const isSaved = (id: number) => ids.value.has(id)
  const get = (id: number) => list.value.find((p) => p.id === id)
  /** Pages added since the pool was last opened. */
  const newPages = (id: number) => {
    const s = get(id)
    return s ? Math.max(0, s.postCount - s.seenCount) : 0
  }

  function save(p: Pool) {
    if (isSaved(p.id)) return
    const entry: SavedPool = {
      id: p.id,
      name: p.name,
      category: p.category,
      postCount: p.postCount,
      coverId: p.postIds[0] ?? null,
      isActive: p.isActive,
      updatedAt: p.updatedAt,
      savedAt: Date.now(),
      seenCount: p.postCount,
    }
    list.value = [entry, ...list.value]
  }

  function remove(id: number) {
    list.value = list.value.filter((p) => p.id !== id)
  }

  /** Save or forget; returns whether the pool is now saved. */
  function toggle(p: Pool): boolean {
    if (isSaved(p.id)) {
      remove(p.id)
      return false
    }
    save(p)
    return true
  }

  /** Fresher copies from the site: keep the saved names, counts and covers up to date. */
  function refresh(pools: Pool[]) {
    const byId = new Map(pools.map((p) => [p.id, p]))
    let changed = false
    const next = list.value.map((s) => {
      const p = byId.get(s.id)
      if (!p) return s
      const coverId = p.postIds[0] ?? s.coverId
      if (s.name === p.name && s.postCount === p.postCount && s.coverId === coverId && s.isActive === p.isActive && s.updatedAt === p.updatedAt && s.category === p.category) return s
      changed = true
      return { ...s, name: p.name, category: p.category, postCount: p.postCount, coverId, isActive: p.isActive, updatedAt: p.updatedAt }
    })
    if (changed) list.value = next
  }

  /** Ask the site for the saved pools' page counts (100 a request): new pages show on Following.
      Returns whether the site answered. */
  async function check(): Promise<boolean> {
    const at = sites.scope
    const ids = list.value.map((p) => p.id)
    if (!ids.length) return true
    try {
      for (let i = 0; i < ids.length; i += 100) {
        const got = await searchPools({ ids: ids.slice(i, i + 100), limit: 100 })
        if (sites.scope !== at) return false // another site meanwhile: its own pools
        refresh(got)
      }
      const now = Date.now()
      for (const p of list.value) p.checkedAt = now
      return true
    } catch {
      return false
    }
  }

  /** Its new pages count as seen without opening it (Following › Mark seen). */
  function markRead(id: number) {
    const s = get(id)
    if (s && s.seenCount !== s.postCount) s.seenCount = s.postCount
  }

  /** The pool was opened: its pages so far count as seen. */
  function markSeen(p: Pool) {
    refresh([p])
    const s = get(p.id)
    if (s && s.seenCount !== p.postCount) s.seenCount = p.postCount
  }

  return { list, count, isSaved, get, newPages, save, remove, toggle, refresh, markSeen, markRead, check }
})
