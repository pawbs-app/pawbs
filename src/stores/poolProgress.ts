import { defineStore } from 'pinia'
import { computed } from 'vue'
import { persistentScoped } from './persist'
import { useSites } from './sites'

export interface PoolRead {
  /** The last page looked at (1 = the first). */
  page: number
  /** Pages the pool had then. */
  total: number
  at: number
}

const KEEP = 500

/* Where each pool was left off, per site: any pool opened, saved in the library or not. A page
   counts as read once it is shown in the gallery or scrolled to in the scroll reader. */
export const usePoolProgress = defineStore('poolProgress', () => {
  const sites = useSites()
  const scope = computed(() => sites.dataScope) // e621 and e926: one set (stores/sites)
  const reads = persistentScoped<Record<string, PoolRead>>(scope, 'pool-progress', () => ({}))

  const get = (poolId: number): PoolRead | undefined => reads.value[poolId]

  function mark(poolId: number, page: number, total: number) {
    // The first page is where every visit starts (and where one goes to switch views): it never
    // overwrites a place. Reading again from the start counts from page 2.
    if (page < 2) return
    const cur = reads.value[poolId]
    if (cur && cur.page === page && cur.total === total) return
    const next: Record<string, PoolRead> = { ...reads.value, [poolId]: { page, total, at: Date.now() } }
    // Bounded: the pools left longest ago go first.
    const ids = Object.keys(next)
    if (ids.length > KEEP) {
      ids
        .sort((a, b) => next[a].at - next[b].at)
        .slice(0, ids.length - KEEP)
        .forEach((id) => delete next[id])
    }
    reads.value = next
  }

  function forget(poolId: number) {
    if (!(poolId in reads.value)) return
    const next = { ...reads.value }
    delete next[poolId]
    reads.value = next
  }

  return { reads, get, mark, forget }
})
