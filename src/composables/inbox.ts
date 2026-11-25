/* Everything followed, in one list: tags, artists and searches (stores/follows) and the saved pools
   (stores/poolLibrary), each with what is new since it was last seen. The Following page and Home
   list it, the title bar's badge and the app icon count it. */
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useFollows, type Follow } from '@/stores/follows'
import { usePoolLibrary, type SavedPool } from '@/stores/poolLibrary'
import { useSites } from '@/stores/sites'
import { looksExplicit } from '@/utils/sfwWords'
import { prettyTag } from '@/query/syntax'

export type InboxKind = 'tag' | 'artist' | 'search' | 'pool'
export interface InboxEntry {
  key: string
  kind: InboxKind
  /** A search's name, else the tag, query or pool's name. */
  label: string
  /** The query under a search's name. */
  sub?: string
  /** New posts (a follow) or new pages (a pool) since last seen. */
  fresh: number
  /** The check stops counting there: "100+". */
  capped: boolean
  checkedAt: number
  to: RouteLocationRaw
  /** The tag's category colour. */
  cls?: string
  follow?: Follow
  pool?: SavedPool
}

export const KIND_LABEL: Record<InboxKind, string> = { tag: 'Tag', artist: 'Artist', search: 'Search', pool: 'Pool' }

export function useInbox() {
  const follows = useFollows()
  const pools = usePoolLibrary()
  const sites = useSites()
  // (On e926, not the pools of a library shared with e621 whose names read as adult.)
  const poolsShown = computed(() => (sites.sfw ? pools.list.filter((p) => !looksExplicit(p.name)) : pools.list))

  const entries = computed<InboxEntry[]>(() => {
    const out: InboxEntry[] = []
    for (const f of follows.shown)
      out.push({
        key: `f:${f.tag}`,
        kind: follows.kindOf(f),
        label: f.name ?? prettyTag(f.tag),
        sub: f.name ? f.tag : undefined,
        fresh: f.fresh,
        capped: f.fresh >= follows.CHECK_LIMIT,
        checkedAt: f.checkedAt,
        to: { path: '/posts', query: { q: f.tag } },
        cls: follows.categoryClass(f.tag),
        follow: f,
      })
    for (const p of poolsShown.value)
      out.push({ key: `p:${p.id}`, kind: 'pool', label: prettyTag(p.name), fresh: pools.newPages(p.id), capped: false, checkedAt: p.checkedAt ?? 0, to: `/pools/${p.id}`, pool: p })
    // What has news first; otherwise as kept (follows newest first, then the pools).
    return [...out.filter((e) => e.fresh > 0), ...out.filter((e) => !e.fresh)]
  })
  const total = computed(() => entries.value.reduce((n, e) => n + e.fresh, 0))

  function markSeen(e: InboxEntry) {
    if (e.follow) follows.markSeen(e.follow.tag)
    else if (e.pool) pools.markRead(e.pool.id)
  }
  function remove(e: InboxEntry) {
    if (e.follow) follows.unfollow(e.follow.tag)
    else if (e.pool) pools.remove(e.pool.id)
  }
  function markAllSeen(newestId?: number) {
    follows.markAllSeen(newestId)
    for (const p of poolsShown.value) pools.markRead(p.id)
  }

  return { entries, total, markSeen, remove, markAllSeen }
}

/** "20 new", "100+ new", "3 new pages". */
export function freshLabel(e: InboxEntry): string {
  return `${e.fresh}${e.capped ? '+' : ''} new${e.kind === 'pool' ? (e.fresh === 1 ? ' page' : ' pages') : ''}`
}
