import { defineStore } from 'pinia'
import { computed, ref, triggerRef } from 'vue'
import { readJson, writeJson } from './persist'
import { useSites } from './sites'
import { getTagsByName } from '@/api/endpoints'
import { Priority } from '@/api/client'

/* Tag categories by name. Posts in the current format carry flat tag lists, so categories are looked
   up in batches and remembered (per site) across sessions. */

const MAX = 12000

interface Stored {
  [name: string]: [number, number] // category, post count
}

export const useTagCache = defineStore('tagcache', () => {
  const sites = useSites()
  const scope = computed(() => sites.scope)
  const map = ref<Map<string, [number, number]>>(new Map())
  let loadedScope = ''
  let saveTimer: number | null = null
  const queued = new Set<string>()
  let batchTimer: number | null = null
  const waiters: (() => void)[] = []

  function load() {
    if (loadedScope === scope.value) return
    loadedScope = scope.value
    const data = readJson<Stored>(`tags:${scope.value}`, {})
    map.value = new Map(Object.entries(data))
  }

  function save() {
    if (saveTimer != null) return
    saveTimer = window.setTimeout(() => {
      saveTimer = null
      let entries = [...map.value.entries()]
      if (entries.length > MAX) entries = entries.slice(entries.length - MAX)
      writeJson(`tags:${loadedScope}`, Object.fromEntries(entries))
    }, 2000)
  }

  function category(name: string): number | undefined {
    load()
    return map.value.get(name)?.[0]
  }

  function count(name: string): number | undefined {
    load()
    return map.value.get(name)?.[1]
  }

  function remember(entries: { name: string; category: number; postCount?: number }[]) {
    load()
    let changed = false
    for (const e of entries) {
      const prev = map.value.get(e.name)
      const next: [number, number] = [e.category, e.postCount ?? prev?.[1] ?? 0]
      if (!prev || prev[0] !== next[0] || prev[1] !== next[1]) {
        map.value.delete(e.name)
        map.value.set(e.name, next)
        changed = true
      }
    }
    if (changed) {
      triggerRef(map)
      save()
    }
  }

  /** Make sure these names have categories; resolves when the lookup is done. */
  function ensure(names: string[], priority = Priority.Viewer): Promise<void> {
    load()
    const missing = names.filter((n) => !map.value.has(n) && !queued.has(n))
    if (!missing.length && !names.some((n) => queued.has(n))) return Promise.resolve()
    missing.forEach((n) => queued.add(n))
    const done = new Promise<void>((res) => waiters.push(res))
    if (batchTimer == null) {
      batchTimer = window.setTimeout(async () => {
        batchTimer = null
        const batch = [...queued]
        const ws = waiters.splice(0)
        const at = scope.value
        try {
          const found = await getTagsByName(batch, priority)
          // The site was switched meanwhile: these are another site's categories, not to be filed here.
          if (scope.value !== at) return
          const seen = new Set(found.map((t) => t.name))
          remember(found.map((t) => ({ name: t.name, category: t.category, postCount: t.postCount })))
          // Names the site does not know (aliases, typos) are filed as general so they are not asked again.
          remember(batch.filter((n) => !seen.has(n)).map((n) => ({ name: n, category: 0, postCount: 0 })))
        } catch {
          /* leave unknown; shown as general */
        } finally {
          batch.forEach((n) => queued.delete(n))
          ws.forEach((w) => w())
        }
      }, 60)
    }
    return done
  }

  /** Forget the categories in memory too (Settings › Data: they are looked up again). */
  function clear() {
    if (saveTimer != null) clearTimeout(saveTimer)
    saveTimer = null
    map.value = new Map()
  }

  return { map, category, count, remember, ensure, clear }
})
