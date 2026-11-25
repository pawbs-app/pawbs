import { defineStore } from 'pinia'
import { computed } from 'vue'
import { persistentScoped } from './persist'
import { useSites } from './sites'
import type { PostSet } from '@/api/types'

export interface SavedSet {
  id: number
  name: string
  shortname: string
  postCount: number
  /** The set's first few posts, for a cover (the first the site shows). */
  coverIds: number[]
  isPublic: boolean
  updatedAt: string
  savedAt: number
}

/* The set library: sets kept in this browser, per site, as the pool library keeps pools. Works
   without an account: anyone's public sets can be kept here. */
export const useSetLibrary = defineStore('setLibrary', () => {
  const sites = useSites()
  const scope = computed(() => sites.dataScope) // e621 and e926: one set (stores/sites)
  const list = persistentScoped<SavedSet[]>(scope, 'set-library', () => [])

  const ids = computed(() => new Set(list.value.map((s) => s.id)))
  const count = computed(() => list.value.length)
  const isSaved = (id: number) => ids.value.has(id)

  const entry = (s: PostSet): SavedSet => ({
    id: s.id,
    name: s.name,
    shortname: s.shortname,
    postCount: s.postCount,
    coverIds: s.postIds.slice(0, 8),
    isPublic: s.isPublic,
    updatedAt: s.updatedAt,
    savedAt: Date.now(),
  })

  function save(s: PostSet) {
    if (!isSaved(s.id)) list.value = [entry(s), ...list.value]
  }
  function remove(id: number) {
    list.value = list.value.filter((s) => s.id !== id)
  }
  /** Save or forget; returns whether the set is now saved. */
  function toggle(s: PostSet): boolean {
    if (isSaved(s.id)) {
      remove(s.id)
      return false
    }
    save(s)
    return true
  }
  /** Fresher copies from the site keep the saved names, counts and covers up to date. */
  function refresh(sets: PostSet[]) {
    const byId = new Map(sets.map((s) => [s.id, s]))
    let changed = false
    const next = list.value.map((saved) => {
      const s = byId.get(saved.id)
      if (!s || (saved.name === s.name && saved.postCount === s.postCount && saved.updatedAt === s.updatedAt && saved.shortname === s.shortname)) return saved
      changed = true
      return { ...entry(s), savedAt: saved.savedAt }
    })
    if (changed) list.value = next
  }

  return { list, count, isSaved, save, remove, toggle, refresh }
})
