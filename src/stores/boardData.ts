/* e621 and e926 keep one set of data (stores/sites, BOARD_SCOPE). Until 1.14.11 each kept its own,
   under its site's id: at every start, before any store reads its data, what is still stored under
   the id of an e621 or e926 site (in use, removed, or arrived with a backup or a transfer from an
   earlier version) is merged into the shared set, and the per-site copy is removed. A key that
   cannot be merged (unexpected contents, storage full) is left where it is, for the next start. */
import { readJson, removeKey, writeJson } from './persist'
import { BOARD_SCOPE, isBoardSite } from './sites'

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : [])
/** The earlier of two times (one missing: the other). */
const earlier = (a: unknown, b: unknown) => {
  const ok = [num(a), num(b)].filter((x) => x > 0)
  return ok.length ? Math.min(...ok) : Date.now()
}

/** Posts kept as copies (favourites, history, a collection's items): one per post, newest first. */
function snaps(a: unknown, b: unknown): Rec[] {
  const by = new Map<number, Rec>()
  for (const s of [...list(a), ...list(b)]) {
    const id = num(s.i)
    const had = by.get(id)
    if (!had || num(s.a) > num(had.a)) by.set(id, s)
  }
  return [...by.values()].sort((x, y) => num(y.a) - num(x.a))
}

/** Entries by a key, the later of two kept (by `at`), newest first. */
const byKey = (key: string, at: string) => (a: unknown, b: unknown): Rec[] => {
  const by = new Map<unknown, Rec>()
  for (const x of [...list(a), ...list(b)]) {
    const had = by.get(x[key])
    if (!had || num(x[at]) > num(had[at])) by.set(x[key], x)
  }
  return [...by.values()].sort((x, y) => num(y[at]) - num(x[at]))
}

/** Followed tags: one per tag; seen up to the later of the two, followed since the earlier. */
function follows(a: unknown, b: unknown): Rec[] {
  const by = new Map<unknown, Rec>()
  for (const f of [...list(a), ...list(b)]) {
    const had = by.get(f.tag)
    if (!had) {
      by.set(f.tag, { ...f })
      continue
    }
    const later = num(f.checkedAt) > num(had.checkedAt) ? f : had
    by.set(f.tag, { ...later, lastSeen: Math.max(num(had.lastSeen), num(f.lastSeen)), addedAt: earlier(had.addedAt, f.addedAt) })
  }
  return [...by.values()]
}

/** Pages read per pool: the later reading of each. */
function progress(a: unknown, b: unknown): Rec {
  const out: Rec = { ...(isRec(a) ? a : {}) }
  for (const [k, v] of Object.entries(isRec(b) ? b : {})) if (isRec(v) && (!isRec(out[k]) || num(v.at) > num((out[k] as Rec).at))) out[k] = v
  return out
}

/** Collections: those of the same name become one (their posts together); the rest side by side. */
function collections(a: unknown, b: unknown): Rec[] {
  const out = list(a).map((c) => ({ ...c }))
  const named = (c: Rec) => String(c.name ?? '').trim().toLowerCase()
  for (const c of list(b)) {
    const same = out.find((x) => named(x) === named(c) && named(c)) ?? out.find((x) => x.id === c.id)
    if (!same) {
      out.push({ ...c })
      continue
    }
    same.items = snaps(same.items, c.items)
    if (!same.description && c.description) same.description = c.description
    same.createdAt = earlier(same.createdAt, c.createdAt)
    same.updatedAt = Math.max(num(same.updatedAt), num(c.updatedAt))
  }
  return out
}

/** The keys kept per site that e621 and e926 share, and how two copies of each become one. Recent
    searches and the tag cache stay per site (a search typed on e621 is not shown on e926). */
const MERGE: Record<string, (a: unknown, b: unknown) => unknown> = {
  fav: snaps,
  viewed: snaps,
  follows,
  hidden: byKey('i', 'at'),
  'pool-library': byKey('id', 'savedAt'),
  'set-library': byKey('id', 'savedAt'),
  'pool-progress': progress,
  collections,
}

/* Saved searches became follows in 1.15.0 (a saved search is followed: it gets a count of new
   posts). They were kept once for every site: each set of kept data (each site's, e621 and e926's
   together) gets them all, first in its list, as not yet checked (the first check takes the site's
   newest post as where they start, stores/follows). The empty search ("Latest") is not one to follow. */
function followKey(raw: string): string {
  const q = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  return q.includes(' ') ? q : q.replace(/^[-~]+/, '')
}
export function moveSavedSearches(): void {
  const saved = readJson<unknown>('saved-searches', undefined)
  if (saved === undefined) return
  const scopes = new Set<string>()
  for (const s of list(readJson<unknown>('sites', []))) if (typeof s.id === 'string' && typeof s.url === 'string') scopes.add(isBoardSite(s.url) ? BOARD_SCOPE : s.id)
  if (!scopes.size && list(saved).length) return // no site yet to keep them under: they wait
  try {
    for (const scope of scopes) {
      const key = `follows:${scope}`
      const have = list(readJson<unknown>(key, []))
      const known = new Set(have.map((f) => f.tag))
      const added: Rec[] = []
      for (const s of list(saved)) {
        const tag = typeof s.query === 'string' ? followKey(s.query) : ''
        if (!tag || known.has(tag)) continue
        known.add(tag)
        const f: Rec = { tag, lastSeen: 0, fresh: 0, checkedAt: 0, addedAt: num(s.createdAt) || Date.now() }
        if (typeof s.name === 'string' && s.name.trim() && s.name.trim().toLowerCase() !== tag) f.name = s.name.trim()
        added.push(f)
      }
      if (added.length && !writeJson(key, [...added, ...have])) return
    }
    removeKey('saved-searches')
  } catch {
    // (Kept as they are, for the next start.)
  }
}

export function shareBoardData(): void {
  const ids = new Set<string>()
  for (const s of list(readJson<unknown>('sites', []))) if (typeof s.id === 'string' && typeof s.url === 'string' && isBoardSite(s.url)) ids.add(s.id)
  const removed = readJson<unknown>('sites:removed', {})
  if (isRec(removed)) for (const [url, id] of Object.entries(removed)) if (typeof id === 'string' && isBoardSite(url)) ids.add(id)
  ids.delete(BOARD_SCOPE)
  if (!ids.size) return
  for (const [key, merge] of Object.entries(MERGE)) {
    const from = [...ids].map((id) => `${key}:${id}`).filter((k) => readJson<unknown>(k, undefined) !== undefined)
    if (!from.length) continue
    try {
      let out = readJson<unknown>(`${key}:${BOARD_SCOPE}`, undefined)
      for (const k of from) {
        const v = readJson<unknown>(k, undefined)
        out = out === undefined ? v : merge(out, v)
      }
      if (!writeJson(`${key}:${BOARD_SCOPE}`, out)) continue
      for (const k of from) removeKey(k)
    } catch {
      // (Left as it is: the stores read the shared copy, this one waits for a version that merges it.)
    }
  }
}
