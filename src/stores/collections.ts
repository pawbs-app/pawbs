import { defineStore } from 'pinia'
import { computed, watch } from 'vue'
import { persistentScoped } from './persist'
import { useSites } from './sites'
import { fromSnapshot, toSnapshot, type Snapshot } from '@/api/snapshot'
import type { Post } from '@/api/types'

export interface Collection {
  id: string
  name: string
  description: string
  /** Newest added first; each copy's `a` is when it went in. */
  items: Snapshot[]
  createdAt: number
  updatedAt: number
}

export type Holding = 'all' | 'some' | 'none'

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

/* Collections: named lists of posts kept in this browser, per site, made and filled without an
   account (the site's own sets need one). Each keeps compact copies of its posts, as favourites do,
   so it opens at once and offline; the full post is fetched when one is opened. */
export const useCollections = defineStore('collections', () => {
  const sites = useSites()
  const scope = computed(() => sites.dataScope) // e621 and e926: one set (stores/sites)
  const list = persistentScoped<Collection[]>(scope, 'collections', () => [])

  const count = computed(() => list.value.length)
  const byId = (id: string) => list.value.find((c) => c.id === id)

  /** Post → the collections holding it. */
  const memberOf = computed(() => {
    const m = new Map<number, string[]>()
    for (const c of list.value)
      for (const s of c.items) {
        const a = m.get(s.i)
        if (a) a.push(c.id)
        else m.set(s.i, [c.id])
      }
    return m
  })
  const collectionsOf = (postId: number): Collection[] => (memberOf.value.get(postId) ?? []).map(byId).filter((c): c is Collection => !!c)

  // Posts are rebuilt from their copies once and shared by every collection holding them.
  const cache = new Map<number, { snap: Snapshot; post: Post }>()
  watch(scope, () => cache.clear())
  function postOf(s: Snapshot): Post {
    const hit = cache.get(s.i)
    if (hit && hit.snap === s) return hit.post
    const post = fromSnapshot(s)
    cache.set(s.i, { snap: s, post })
    return post
  }
  // (On e926, only the safe ones of collections shared with e621.)
  const postsOf = (c: Collection): Post[] => (sites.sfw ? c.items.filter((s) => s.r === 's') : c.items).map(postOf)

  function holding(id: string, postIds: number[]): Holding {
    const c = byId(id)
    if (!c || !postIds.length) return 'none'
    const have = new Set(c.items.map((s) => s.i))
    const n = postIds.reduce((k, pid) => k + (have.has(pid) ? 1 : 0), 0)
    return n === 0 ? 'none' : n === postIds.length ? 'all' : 'some'
  }

  function change(id: string, fn: (c: Collection) => Collection | null) {
    let hit = false
    const next: Collection[] = []
    for (const c of list.value) {
      if (c.id !== id) next.push(c)
      else {
        hit = true
        const n = fn(c)
        if (n) next.push(n)
      }
    }
    if (hit) list.value = next
  }

  function create(name: string, description = '', posts: Post[] = []): Collection {
    const now = Date.now()
    const c: Collection = { id: newId(), name: name.trim(), description: description.trim(), items: [], createdAt: now, updatedAt: now }
    list.value = [c, ...list.value]
    if (posts.length) add(c.id, posts)
    return byId(c.id) ?? c
  }
  function edit(id: string, fields: { name: string; description: string }) {
    change(id, (c) => ({ ...c, name: fields.name.trim(), description: fields.description.trim(), updatedAt: Date.now() }))
  }
  /** Delete one; returns it and where it was, for an undo. */
  function remove(id: string): { c: Collection; at: number } | null {
    const at = list.value.findIndex((c) => c.id === id)
    if (at < 0) return null
    const c = list.value[at]
    list.value = list.value.filter((x) => x.id !== id)
    return { c, at }
  }
  function restore(c: Collection, at = 0) {
    if (byId(c.id)) return
    const next = [...list.value]
    next.splice(Math.min(at, next.length), 0, c)
    list.value = next
  }

  /** Put posts in (the first of the list ends up first); returns how many were new. */
  function add(id: string, posts: Post[]): number {
    let n = 0
    change(id, (c) => {
      const have = new Set(c.items.map((s) => s.i))
      const now = Date.now()
      const fresh: Snapshot[] = []
      for (const p of posts) {
        if (have.has(p.id)) continue
        have.add(p.id)
        const s = toSnapshot(p)
        s.a = now - fresh.length
        fresh.push(s)
      }
      n = fresh.length
      return n ? { ...c, items: [...fresh, ...c.items], updatedAt: now } : c
    })
    return n
  }
  /** Take posts out; returns the copies taken, for an undo (`putBack`). */
  function take(id: string, postIds: number[]): Snapshot[] {
    const out = new Set(postIds)
    let taken: Snapshot[] = []
    change(id, (c) => {
      taken = c.items.filter((s) => out.has(s.i))
      return taken.length ? { ...c, items: c.items.filter((s) => !out.has(s.i)), updatedAt: Date.now() } : c
    })
    return taken
  }
  /** Put taken copies back where they were (by the time they were added). */
  function putBack(id: string, snaps: Snapshot[]) {
    change(id, (c) => {
      const have = new Set(c.items.map((s) => s.i))
      const back = snaps.filter((s) => !have.has(s.i))
      if (!back.length) return c
      const items = [...c.items, ...back].sort((x, y) => (y.a ?? 0) - (x.a ?? 0))
      return { ...c, items, updatedAt: Date.now() }
    })
  }

  /** Newer data for a post seen again (fresh URLs, score, tags) updates its copies. */
  function refresh(post: Post) {
    if (post.partial || !memberOf.value.has(post.id)) return
    const next = toSnapshot(post)
    let changed = false
    const lists = list.value.map((c) => {
      const i = c.items.findIndex((s) => s.i === post.id)
      if (i < 0) return c
      const old = c.items[i]
      if (old.f === next.f && old.sc === next.sc && old.fc === next.fc && old.t === next.t) return c
      changed = true
      const items = [...c.items]
      items[i] = { ...next, a: old.a }
      return { ...c, items }
    })
    if (changed) list.value = lists
  }

  return { list, count, byId, collectionsOf, postsOf, holding, create, edit, remove, restore, add, take, putBack, refresh }
})
