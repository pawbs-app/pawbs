/* Followed tags and the signed-in account's tag subscriptions (the site's own followed tags: single
   tags only, 500 at most, the same list on e621 and e926).

   Sync (opt-in, stores/follows: `sync`): pawbs's plain-tag follows and the account's subscriptions
   kept the same both ways. What changed on each side is found against the account's list as it was at
   the last sync (the snapshot): a tag on the account and not in the snapshot was added there, one in
   the snapshot and gone from the account was removed there, and the same for pawbs's side. The first
   sync (no snapshot) merges both lists and removes nothing. An alias followed here is stored by the
   site as the tag it points to: the follow keeps that link (`synced`), or every sync would add it
   again. A tag the account does not take (it does not exist yet, the 500 limit) stays a follow here
   only (`localOnly`), and is offered again only when asked (Sync now).

   Searches, pools and what has been seen stay pawbs's own (per device).

   Counting: the synced tags' new posts come from one search, `search:subscriptions`, newest first,
   counted per tag here from each post's tags. A follow whose last seen post lies below what the
   pages reached is left to the usual one-request check. */
import { nextTick } from 'vue'
import { aliasTarget, listSubscriptions, searchPosts, subscribeTags, unsubscribeTag, type Subscription } from '@/api/endpoints'
import { Priority } from '@/api/client'
import { useFollows, type Follow } from '@/stores/follows'
import { useSites } from '@/stores/sites'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'

/** A tag as the account can hold it (no spaces, metatags or wildcards). */
export const isPlainTag = (tag: string) => !/[\s:*]/.test(tag)
/** The tag a follow stands for on the account. */
const onAccount = (f: Follow) => f.synced ?? f.tag

export interface SyncReport {
  /** Followed here from the account, and unfollowed here because the account dropped them. */
  pulled: number
  dropped: number
  /** Added to the account, and removed from it. */
  pushed: number
  removed: number
  /** Kept here only: the account would not take them. */
  refused: number
  /** Tags on the account now. */
  total: number
}

function signedIn() {
  const s = useSites()
  return s.hasAccount && s.active ? s.active : null
}

/** Follow these tags here, already linked to the account (they came from it). */
function followFromAccount(tags: string[]) {
  const follows = useFollows()
  if (!tags.length) return
  follows.followMany(tags)
  const set = new Set(tags)
  for (const f of follows.list) if (set.has(f.tag)) f.synced = f.tag
}

/** Add these follows to the account, and link each to the tag the site stored. */
async function pushFollows(fs: Follow[], remote: Map<string, number>): Promise<{ pushed: number; refused: number }> {
  let pushed = 0
  let refused = 0
  for (let i = 0; i < fs.length; i += 400) {
    const chunk = fs.slice(i, i + 400)
    const { added, skipped } = await subscribeTags(chunk.map((f) => f.tag))
    for (const a of added) remote.set(a.tag, a.id)
    pushed += added.length
    const why = new Map(skipped.map((s) => [s.name.toLowerCase(), s.reason]))
    for (const f of chunk) {
      const reason = why.get(f.tag)
      if (remote.has(f.tag)) {
        f.synced = f.tag
        delete f.localOnly
      } else if (reason && !/already/i.test(reason)) {
        f.localOnly = reason
        refused++
      } else {
        // Neither added under its name nor refused: an alias, stored as the tag it points to.
        const target = await aliasTarget(f.tag).catch(() => null)
        if (target && remote.has(target)) {
          f.synced = target
          delete f.localOnly
        }
      }
    }
  }
  return { pushed, refused }
}

/** Sync pawbs's tag follows with the account's subscriptions (see the top of this file). `retry`:
    offer the tags the account refused before once more. */
export async function syncFollows(opts: { retry?: boolean } = {}): Promise<SyncReport> {
  const follows = useFollows()
  const site = signedIn()
  if (!site) throw new Error('Sign in to an account (Settings › Sites) to sync follows.')
  const st = follows.sync
  // Another account than the last sync's: its list starts from scratch (merged, nothing removed).
  if (st.user && st.user.toLowerCase() !== site.username.toLowerCase()) {
    st.snapshot = []
    for (const f of follows.list) delete f.synced
  }
  const list: Subscription[] = await listSubscriptions()
  const remote = new Map(list.map((s) => [s.tag, s.id]))
  const before = new Set(st.snapshot)
  let plain = follows.list.filter((f) => isPlainTag(f.tag))

  // Removed on the account since the last sync: unfollowed here.
  const dropTags = plain.filter((f) => f.synced && before.has(f.synced) && !remote.has(f.synced)).map((f) => f.tag)
  for (const t of dropTags) follows.unfollow(t)
  plain = follows.list.filter((f) => isPlainTag(f.tag))
  // Tags on both sides already: linked.
  for (const f of plain) if (!f.synced && remote.has(f.tag)) f.synced = f.tag
  // Followed here and not on the account (new here, or never synced): added to it. First, so that an
  // alias followed here is linked to the tag the account holds before the account's tags are read
  // as new ones (it would be followed twice, under both names).
  if (opts.retry) for (const f of plain) delete f.localOnly
  const toPush = plain.filter((f) => !remote.has(onAccount(f)) && !(f.synced && before.has(f.synced)) && !f.localOnly)
  const { pushed, refused } = toPush.length ? await pushFollows(toPush, remote) : { pushed: 0, refused: 0 }
  const here = new Map(plain.map((f) => [onAccount(f), f]))
  // Added on the account since the last sync: followed here.
  const pullTags = [...remote.keys()].filter((t) => !here.has(t) && !before.has(t))
  followFromAccount(pullTags)
  // Unfollowed here since the last sync: removed from the account.
  const toRemove = [...before].filter((t) => remote.has(t) && !here.has(t))
  let removed = 0
  for (const t of toRemove) {
    const id = remote.get(t)
    if (id == null) continue
    await unsubscribeTag(id)
    remote.delete(t)
    removed++
  }
  st.snapshot = [...remote.keys()]
  st.user = site.username
  st.at = Date.now()
  st.error = ''
  return { pulled: pullTags.length, dropped: dropTags.length, pushed, removed, refused, total: remote.size }
}

/**
 * An account has just signed in (first setup, or an account entered in Settings › Sites; `site`: the
 * site's address, when it may not be the one in use). Its first sign-in on this device turns sync on:
 * the first sync only adds, both ways. Later sign-ins keep what was chosen since; a site without
 * followed tags stays off, quietly. Accounts signed in before this existed are left as they are.
 */
export async function syncOnSignIn(site?: string): Promise<void> {
  // A first site just added changes the data scope, whose follows and sync state come in on the
  // next tick: set before that, the choice would land in the old scope's.
  await nextTick()
  const follows = useFollows()
  const s = signedIn()
  if (!s || (site && site !== s.url)) return
  const key = `${s.url}|${s.username.toLowerCase()}`
  if (follows.signedInBefore.includes(key) || follows.sync.on) return
  follows.sync.on = true
  follows.sync.error = ''
  const r = await follows.syncNow()
  if (!r) {
    const unsupported = /does not keep followed tags/.test(follows.sync.error)
    follows.stopSync()
    // Not now (offline, the site down): tried again at the next sign-in. A site without them: never.
    if (unsupported) follows.signedInBefore = [...follows.signedInBefore, key]
    return
  }
  follows.signedInBefore = [...follows.signedInBefore, key]
  const moved = [r.pulled && `${r.pulled} followed from it`, r.pushed && `${r.pushed} added to it`].filter(Boolean).join(', ')
  useUi().toast(`Followed tags now in sync with your ${s.name} account${moved ? ` (${moved})` : ''}. To stop: Following › Stop syncing`, { tone: 'ok', ms: 9000 })
}

/** Once, without syncing: the account's tags followed here (nothing removed). */
export async function importSubscriptions(): Promise<number> {
  const follows = useFollows()
  const known = new Set(follows.list.map(onAccount))
  const tags = (await listSubscriptions()).map((s) => s.tag).filter((t) => !known.has(t))
  followFromAccount(tags)
  return tags.length
}
/** Once, without syncing: pawbs's tag follows added to the account (nothing removed). */
export async function exportFollows(): Promise<{ pushed: number; refused: number }> {
  const follows = useFollows()
  const remote = new Map((await listSubscriptions()).map((s) => [s.tag, s.id]))
  const fs = follows.list.filter((f) => isPlainTag(f.tag) && !remote.has(onAccount(f)))
  return fs.length ? pushFollows(fs, remote) : { pushed: 0, refused: 0 }
}

const PAGE = 320
const MAX_PAGES = 4
/**
 * New posts of synced follows from one search, per follow: `fresh` (capped at `cap`) and `newest`.
 * Returns the follows it settled; the others (their last seen post lies below the pages read) are
 * left to the usual check.
 */
export async function countSynced(fs: Follow[], cap: number): Promise<Map<Follow, { fresh: number; newest: number }>> {
  const out = new Map<Follow, { fresh: number; newest: number }>()
  const watched = fs.filter((f) => f.synced && f.lastSeen > 0)
  if (!watched.length) return out
  const oldest = Math.min(...watched.map((f) => f.lastSeen))
  const flash = useSettings().s.blockFlash ? ' -type:swf' : ''
  const byTag = new Map<string, Follow[]>()
  for (const f of watched) byTag.set(f.synced!, [...(byTag.get(f.synced!) ?? []), f])
  const counts = new Map(watched.map((f) => [f, { fresh: 0, newest: 0 }]))
  let lowest = Infinity
  let complete = false
  let page: string | undefined
  for (let i = 0; i < MAX_PAGES; i++) {
    const posts = await searchPosts(`search:subscriptions id:>${oldest}${flash}`, { limit: PAGE, page, priority: Priority.Idle, ttl: 0 })
    for (const p of posts) {
      lowest = Math.min(lowest, p.id)
      for (const t of p.tags)
        for (const f of byTag.get(t) ?? []) {
          if (p.id <= f.lastSeen) continue
          const c = counts.get(f)!
          c.fresh++
          c.newest = Math.max(c.newest, p.id)
        }
    }
    if (posts.length < PAGE) {
      complete = true
      break
    }
    page = `b${lowest}`
  }
  for (const [f, c] of counts) {
    // Settled: everything newer than its last seen post was read, or it is past the cap anyway.
    if (complete || f.lastSeen >= lowest - 1 || c.fresh >= cap) out.set(f, { fresh: Math.min(c.fresh, cap), newest: c.newest })
  }
  return out
}
