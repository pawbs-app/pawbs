import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { persistentScoped } from './persist'
import { looksExplicit } from '@/utils/sfwWords'
import { useSites } from './sites'
import { useSettings } from './settings'
import { useTagCache } from './tagcache'
import { usePoolLibrary } from './poolLibrary'
import { searchPosts } from '@/api/endpoints'
import { Priority } from '@/api/client'
import { countSynced, syncFollows, type SyncReport } from '@/services/followSync'

export interface Follow {
  /** What is followed: a tag, or a whole search (any query, since 1.15.0). */
  tag: string
  /** A name given to a search (saved searches before 1.15.0 had one). */
  name?: string
  /** Newest post id already seen (0: none yet; the next check takes the site's newest as the start). */
  lastSeen: number
  /** When it was last marked seen: results say "new since" then. */
  seenAt?: number
  /** New posts at the last check (capped at CHECK_LIMIT). */
  fresh: number
  /** The newest post the last check counted: marking the tag seen moves lastSeen up to it. */
  newest?: number
  checkedAt: number
  addedAt: number
  /** Synced with the account (services/followSync): the tag as the account holds it (an alias
      followed here is stored as the tag it points to). */
  synced?: string
  /** The account would not take it (the site's reason): followed here only. */
  localOnly?: string
}

/** Sync with the account's followed tags (services/followSync), per data scope. */
export interface FollowSync {
  on: boolean
  /** The account the snapshot is of. */
  user: string
  /** The account's tags at the last sync: what changed since, on either side, is found against it. */
  snapshot: string[]
  at: number
  error: string
}

const CHECK_LIMIT = 100
const AUTO_CHECK_MS = 30 * 60_000

/* Followed tags and searches: a client-side watch list. A check asks the site for posts newer than
   the last one seen, one follow at a time at background priority, then the saved pools' page counts
   (stores/poolLibrary). Saved searches became follows in 1.15.0 (stores/boardData moves them). */
export const useFollows = defineStore('follows', () => {
  const sites = useSites()
  const scope = computed(() => sites.dataScope) // e621 and e926: one set (stores/sites)
  const list = persistentScoped<Follow[]>(scope, 'follows', () => [])
  const checking = ref(false)
  const progress = ref(0)
  const sync = persistentScoped<FollowSync>(scope, 'follows:sync', () => ({ on: false, user: '', snapshot: [], at: 0, error: '' }))
  const syncing = ref(false)
  /** Sync now; resolves with what moved, or null when it failed (the reason in sync.error). */
  async function syncNow(retry = false): Promise<SyncReport | null> {
    if (syncing.value || !sync.value.on || !sites.hasAccount) return null
    syncing.value = true
    try {
      return await syncFollows({ retry })
    } catch (e) {
      sync.value.error = (e as Error).message || String(e)
      return null
    } finally {
      syncing.value = false
    }
  }
  /** Sync off: the follows stay as they are; turned on again later, both lists merge (nothing removed).
      Each tag's link to the account's (an alias and the tag it stands for) is kept: an import or
      export meanwhile would otherwise follow or send the same tag twice under its two names. */
  function stopSync() {
    sync.value = { on: false, user: sync.value.user, snapshot: [], at: 0, error: '' }
    for (const f of list.value) delete f.localOnly
  }

  /** The follows to show on the site in use: on e926, not the tags of a set shared with e621 that read
      as adult (utils/sfwWords). The list itself keeps them all. */
  const shown = computed(() => (sites.sfw ? list.value.filter((f) => !looksExplicit(f.tag, f.name)) : list.value))
  const totalFresh = computed(() => shown.value.reduce((n, f) => n + f.fresh, 0))
  /** The follow of a tag or a search, as typed anywhere (spaces, case and a lone tag's - or ~ aside). */
  const find = (q: string): Follow | undefined => {
    const k = normalize(q)
    return k ? list.value.find((f) => f.tag === k) : undefined
  }
  const isFollowed = (tag: string) => !!find(tag)

  // Lists saved before 1.5.0 could hold the same tag twice (fast repeated adds): merge them.
  watch(
    () => [scope.value, list.value.length],
    () => {
      const byTag = new Map<string, Follow>()
      for (const f of list.value) {
        const kept = byTag.get(f.tag)
        if (kept) kept.lastSeen = Math.max(kept.lastSeen, f.lastSeen)
        else byTag.set(f.tag, f)
      }
      if (byTag.size < list.value.length) list.value = [...byTag.values()]
    },
    { immediate: true },
  )

  /** A plain tag (not a query with metatags, spaces or wildcards): it has a category and a colour. */
  const isPlainTag = (tag: string) => !/[\s:*]/.test(tag)
  // Synced: a tag followed or unfollowed here reaches the account a few seconds later.
  let syncTimer: number | null = null
  watch(
    () => (sync.value.on ? list.value.filter((f) => isPlainTag(f.tag)).map((f) => f.tag).sort().join(' ') : null),
    (now, before) => {
      if (now == null || before == null || now === before) return
      if (syncTimer != null) clearTimeout(syncTimer)
      syncTimer = window.setTimeout(() => {
        syncTimer = null
        void syncNow()
      }, 4000)
    },
  )
  // Followed tags show in their category colour: look up the ones not known yet (one batched
  // request, remembered across visits), quietly in the background.
  const tagcache = useTagCache()
  watch(
    () => [sites.scope, list.value.length],
    () => void tagcache.ensure(list.value.map((f) => f.tag).filter(isPlainTag), Priority.Background),
    { immediate: true },
  )
  /** The colour class of a followed tag (general until its category is known); none for a query. */
  const categoryClass = (tag: string) => (isPlainTag(tag) ? `cat-${tagcache.category(tag) ?? 0}` : '')

  /* The newest post on the whole site: "new since following" counts from it. Post ids only grow, so
     a single answer serves any number of tags followed at once, instead of one lookup per tag. */
  let newest: { scope: string; at: number; id: number } | null = null
  async function siteNewest(): Promise<number> {
    const at = sites.scope
    if (newest && newest.scope === at && Date.now() - newest.at < 60_000) return newest.id
    const r = await searchPosts('', { limit: 1, priority: Priority.User, ttl: 0 })
    const id = r[0]?.id ?? 0
    if (id && sites.scope === at) newest = { scope: at, at: Date.now(), id }
    return id
  }

  /** A tag as followed: lower case, without a leading - or ~ (operators from a pasted query). A
      search: lower case, its words one space apart. */
  function normalize(raw: string): string {
    const q = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    return q.includes(' ') ? q : q.replace(/^[-~]+/, '')
  }
  /** A follow's kind, for the lists: an artist (by the tag's category), a tag, or a search. */
  function kindOf(f: Follow): 'artist' | 'tag' | 'search' {
    if (!isPlainTag(f.tag)) return 'search'
    return tagcache.category(f.tag) === 1 ? 'artist' : 'tag'
  }

  /** Follow tags (one, or a whole pasted list): normalised, each once, added in a single change
      (so the Following feed reloads once). Returns how many were new. */
  function followMany(tags: string[], name?: string): number {
    const known = new Set(list.value.map((f) => f.tag))
    const now = Date.now()
    const added: Follow[] = []
    for (const raw of tags) {
      const tag = normalize(raw)
      if (!tag || known.has(tag)) continue
      known.add(tag)
      const f: Follow = { tag, lastSeen: 0, fresh: 0, checkedAt: now, addedAt: now }
      if (name?.trim() && name.trim().toLowerCase() !== tag) f.name = name.trim()
      added.push(f)
    }
    if (!added.length) return 0
    list.value = [...added, ...list.value]
    const names = new Set(added.map((f) => f.tag))
    siteNewest()
      .then((id) => {
        if (!id) return
        for (const f of list.value) if (names.has(f.tag) && f.lastSeen === 0) f.lastSeen = id
      })
      .catch(() => {
        /* lastSeen stays 0: everything counts as new until the first check */
      })
    return added.length
  }

  /** Follow a tag or a whole search (with a name for it, when given). */
  function follow(q: string, name?: string) {
    followMany([q], name)
  }

  function unfollow(tag: string) {
    const k = normalize(tag)
    list.value = list.value.filter((f) => f.tag !== k)
  }

  function rename(tag: string, name: string) {
    const f = find(tag)
    if (!f) return
    if (name.trim() && name.trim().toLowerCase() !== f.tag) f.name = name.trim()
    else delete f.name
  }

  function toggle(tag: string) {
    if (isFollowed(tag)) unfollow(tag)
    else void follow(tag)
  }

  /* Seen: up to the newest post shown (when known) or counted by the last check, so the next check
     does not count the same posts again. (Hiding the count alone brought it back at the next check.)
     A follow checked before the newest post was kept takes the site's newest post. */
  function seen(f: Follow, newestId?: number) {
    const upTo = Math.max(newestId ?? 0, f.newest ?? 0)
    if (upTo > f.lastSeen) f.lastSeen = upTo
    f.fresh = 0
    f.seenAt = Date.now()
    if (upTo) return
    const at = sites.scope
    siteNewest()
      .then((id) => {
        const cur = sites.scope === at ? list.value.find((x) => x.tag === f.tag) : undefined
        if (cur && id > cur.lastSeen) cur.lastSeen = id
      })
      .catch(() => {
        /* counted again at the next check */
      })
  }

  /** Mark a tag as read up to the given post id (the newest one shown), or what the last check counted. */
  function markSeen(tag: string, newestId?: number) {
    const f = find(tag)
    if (f) seen(f, newestId)
  }

  function markAllSeen(newestId?: number) {
    for (const f of list.value) seen(f, newestId)
  }

  const pools = usePoolLibrary()
  async function check(force = false) {
    if (checking.value || (!list.value.length && !pools.list.length) || !sites.active) return
    checking.value = true
    progress.value = 0
    let targets = list.value.filter((f) => force || Date.now() - f.checkedAt > AUTO_CHECK_MS / 2)
    const at = sites.scope
    let done = 0
    try {
      // Synced with the account: the lists made the same first, then the synced tags counted from
      // one search (services/followSync); what it does not settle is checked one by one below.
      if (sync.value.on && sites.hasAccount) {
        await syncNow()
        if (sites.scope !== at) return
        try {
          const settled = await countSynced(
            targets.filter((f) => f.synced),
            CHECK_LIMIT,
          )
          if (sites.scope !== at) return
          for (const [f, c] of settled) {
            const cur = list.value.find((x) => x.tag === f.tag)
            if (!cur) continue
            cur.fresh = c.fresh
            cur.checkedAt = Date.now()
            if (c.newest) cur.newest = Math.max(cur.newest ?? 0, c.newest)
          }
          targets = targets.filter((f) => !settled.has(f))
        } catch {
          /* the search failed: every follow checked on its own below */
        }
      }
      for (const f of targets) {
        // The site was switched: these follows (and their counts) belong to the other one.
        if (sites.scope !== at) break
        try {
          // Not seen at all yet (a search moved over from the saved ones): the site's newest post is
          // where it starts, rather than a hundred "new" posts that are only old ones.
          if (!f.lastSeen) {
            const id = await siteNewest()
            const cur = sites.scope === at ? list.value.find((x) => x.tag === f.tag) : undefined
            if (cur && id && !cur.lastSeen) Object.assign(cur, { lastSeen: id, fresh: 0, checkedAt: Date.now() })
            done++
            progress.value = done / targets.length
            continue
          }
          const flash = useSettings().s.blockFlash ? ' -type:swf' : ''
          const posts = await searchPosts(`${f.tag} id:>${f.lastSeen}${flash}`, { limit: CHECK_LIMIT, priority: Priority.Idle, ttl: 0 })
          const cur = sites.scope === at ? list.value.find((x) => x.tag === f.tag) : undefined
          if (cur) {
            cur.fresh = posts.length
            cur.checkedAt = Date.now()
            if (posts.length) cur.newest = Math.max(cur.newest ?? 0, ...posts.map((p) => p.id))
          }
        } catch {
          /* skip this one */
        }
        done++
        progress.value = done / targets.length
      }
      // The saved pools too (a few requests for all of them): their new pages show beside the follows.
      if (sites.scope === at && (force || pools.list.some((p) => Date.now() - (p.checkedAt ?? 0) > AUTO_CHECK_MS / 2))) await pools.check()
    } finally {
      checking.value = false
    }
  }

  function autoCheck() {
    const stale = list.value.some((f) => Date.now() - f.checkedAt > AUTO_CHECK_MS) || pools.list.some((p) => Date.now() - (p.checkedAt ?? 0) > AUTO_CHECK_MS)
    if (stale) void check()
  }

  return {
    list,
    shown,
    checking,
    progress,
    totalFresh,
    find,
    isFollowed,
    kindOf,
    categoryClass,
    follow,
    followMany,
    unfollow,
    rename,
    toggle,
    markSeen,
    markAllSeen,
    check,
    autoCheck,
    sync,
    syncing,
    syncNow,
    stopSync,
    CHECK_LIMIT,
  }
})
