/* The names of the pools a post belongs to (posts only carry their ids), for right-click menus.
   Asked for in batches, kept for the session, per site. Reactive: a menu open before a name
   arrives shows it as soon as it does. Saved pools (the library) are known at once. */
import { reactive } from 'vue'
import { searchPools } from '@/api/endpoints'
import { useSites } from '@/stores/sites'
import { usePoolLibrary } from '@/stores/poolLibrary'

const names = reactive(new Map<string, string>())
const asked = new Set<string>()
let queued = new Set<number>()
let timer: number | null = null

const site = () => useSites().active?.id ?? ''

/** The pool's name if known yet (asks for it otherwise). */
export function poolName(id: number): string | undefined {
  const known = names.get(`${site()}:${id}`) ?? usePoolLibrary().get(id)?.name
  if (known === undefined) wantPoolNames([id])
  return known
}

/** Look these pools' names up ahead of a menu (the gallery does for the post on screen). */
export function wantPoolNames(ids: number[]) {
  const s = site()
  for (const id of ids) {
    const k = `${s}:${id}`
    if (names.has(k) || asked.has(k)) continue
    asked.add(k)
    queued.add(id)
  }
  if (queued.size && timer == null) timer = window.setTimeout(load, 30)
}

async function load() {
  timer = null
  const ids = [...queued]
  queued = new Set()
  const s = site()
  try {
    for (const p of await searchPools({ ids, limit: Math.max(ids.length, 1) })) names.set(`${s}:${p.id}`, p.name)
  } catch {
    for (const id of ids) asked.delete(`${s}:${id}`) // asked again next time
  }
}
