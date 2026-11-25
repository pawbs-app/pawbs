import { defineStore } from 'pinia'
import { computed } from 'vue'
import { persistentScoped } from './persist'
import { useSites } from './sites'

/* Recent searches, per site. (Saved searches became follows in 1.15.0: stores/follows, moved over
   by stores/boardData.) */
export interface RecentSearch {
  q: string
  at: number
  n: number // times used
}

const RECENT_MAX = 40

export const useSearches = defineStore('searches', () => {
  const sites = useSites()
  const scope = computed(() => sites.scope)
  const recent = persistentScoped<RecentSearch[]>(scope, 'recent', () => [])

  function remember(query: string) {
    const q = query.trim()
    if (!q) return
    const prev = recent.value.find((r) => r.q === q)
    const rest = recent.value.filter((r) => r.q !== q)
    recent.value = [{ q, at: Date.now(), n: (prev?.n ?? 0) + 1 }, ...rest].slice(0, RECENT_MAX)
  }
  function forget(q: string) {
    recent.value = recent.value.filter((r) => r.q !== q)
  }
  function clearRecent() {
    recent.value = []
  }

  return { recent, remember, forget, clearRecent }
})
