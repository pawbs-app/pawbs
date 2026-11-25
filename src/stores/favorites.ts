import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { persistentScoped } from './persist'
import { useSites } from './sites'
import { useSettings } from './settings'
import { useUi } from './ui'
import { fromSnapshot, toSnapshot, type Snapshot } from '@/api/snapshot'
import type { Post } from '@/api/types'
import { addRemoteFavorite, removeRemoteFavorite } from '@/api/endpoints'

export const useFavorites = defineStore('favorites', () => {
  const sites = useSites()
  const scope = computed(() => sites.dataScope) // e621 and e926: one set (stores/sites)
  /** Newest first. */
  const items = persistentScoped<Snapshot[]>(scope, 'fav', () => [])
  const ids = computed(() => new Set(items.value.map((s) => s.i)))
  // (Shown, and counted, on the site in use: on e926, only the safe ones of a set shared with e621.)
  const count = computed(() => (sites.sfw ? items.value.reduce((n, s) => n + (s.r === 's' ? 1 : 0), 0) : items.value.length))

  // Posts are rebuilt lazily and kept stable between renders.
  const cache = new Map<number, Post>()
  const posts = shallowRef<Post[]>([])
  watch(
    [items, () => sites.sfw],
    ([list]) => {
      posts.value = list.filter((s) => sites.shows(s.r)).map((s) => {
        let p = cache.get(s.i)
        if (!p) {
          p = fromSnapshot(s)
          cache.set(s.i, p)
        }
        return p
      })
    },
    { immediate: true, deep: true },
  )
  watch(scope, () => cache.clear())
  // (The account's favourites are the site's own: another site, even e926 after e621, asks again.)
  watch(
    () => sites.scope,
    () => (remote.value = new Map()),
  )

  function has(id: number) {
    return ids.value.has(id)
  }

  /* The account's favourites follow, one request at a time per post, each sending the state at that
     moment: saving and unsaving quickly sent both at once, and the site could apply them in the
     wrong order (the post ended up saved here, not there, or the reverse). */
  const remoteQueue = new Map<number, Promise<void>>()
  const remoteSent = new Map<string, boolean>() // by site and post: what the account was last told
  function syncRemote(id: number) {
    const next = (remoteQueue.get(id) ?? Promise.resolve()).then(() => sendRemote(id))
    remoteQueue.set(id, next)
    void next.finally(() => {
      if (remoteQueue.get(id) === next) remoteQueue.delete(id)
    })
  }
  async function sendRemote(id: number) {
    const settings = useSettings()
    if (!sites.hasAccount || !settings.s.syncRemoteFavorites) return
    const add = has(id)
    const key = `${sites.scope}:${id}`
    if (remoteSent.get(key) === add) return // already says so (a quick toggle back and forth)
    try {
      if (add) await addRemoteFavorite(id)
      else await removeRemoteFavorite(id)
      remoteSent.set(key, add)
    } catch (e) {
      const msg = (e as Error).message
      // Already in / not in the account's favourites: that is the state wanted, nothing to report.
      if (/already|not found|422|404/i.test(msg)) return void remoteSent.set(key, add)
      useUi().toast(`Saved here, but the account’s favourites were not updated: ${msg}`, { tone: 'warn' })
    }
  }

  function add(post: Post, opts: { remote?: boolean } = {}) {
    if (has(post.id)) return
    const snap = toSnapshot(post)
    snap.a = Date.now()
    items.value.unshift(snap)
    cache.set(post.id, post)
    if (opts.remote !== false) syncRemote(post.id)
  }

  function remove(id: number, opts: { remote?: boolean } = {}) {
    items.value = items.value.filter((s) => s.i !== id)
    cache.delete(id)
    if (opts.remote !== false) syncRemote(id)
  }

  /* What the account says, as last changed here; posts loaded with the account also carry it. */
  const remote = ref(new Map<number, boolean>())

  /** Saved here, or in the account's favourites (when the site told us, or we changed it). */
  function isSaved(post: Post): boolean {
    if (ids.value.has(post.id)) return true
    if (!sites.hasAccount) return false
    return remote.value.get(post.id) ?? post.isFavorited
  }

  function setRemote(id: number, on: boolean) {
    if (!sites.hasAccount) return
    const next = new Map(remote.value)
    next.set(id, on)
    remote.value = next
  }

  function toggle(post: Post): boolean {
    if (isSaved(post)) {
      remove(post.id)
      setRemote(post.id, false)
      return false
    }
    add(post)
    setRemote(post.id, true)
    return true
  }

  /** Add many (import), keeping existing entries; returns how many were new. */
  function addMany(list: Post[]): number {
    let n = 0
    const now = Date.now()
    const fresh: Snapshot[] = []
    for (const p of list) {
      if (ids.value.has(p.id) || fresh.some((f) => f.i === p.id)) continue
      const s = toSnapshot(p)
      s.a = now - n
      fresh.push(s)
      n++
    }
    if (n) items.value = [...fresh, ...items.value]
    return n
  }

  /** Refresh stored copies with newer data (URLs, scores) when a post is seen again. */
  function refresh(post: Post) {
    const idx = items.value.findIndex((s) => s.i === post.id)
    if (idx < 0 || post.partial) return
    const old = items.value[idx]
    const next = toSnapshot(post)
    next.a = old.a
    if (old.f === next.f && old.sc === next.sc && old.fc === next.fc && old.t === next.t) return
    items.value[idx] = next
    cache.set(post.id, post)
  }

  function clear() {
    items.value = []
    cache.clear()
  }

  return { items, posts, ids, count, has, isSaved, add, remove, toggle, addMany, refresh, clear }
})
