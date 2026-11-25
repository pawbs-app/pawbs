/* Right-click menus for searches and tags, shared by the pages that list them (Home, History,
   Following, the details panel, the refine bar). */
import { useRouter } from 'vue-router'
import { useFollows, type Follow } from '@/stores/follows'
import { useBlacklist } from '@/stores/blacklist'
import { usePoolLibrary } from '@/stores/poolLibrary'
import type { InboxEntry } from '@/composables/inbox'
import { useUi } from '@/stores/ui'
import { openInNewTab, type MenuEntry } from '@/services/contextMenu'
import { copyText } from '@/composables/dom'
import { prettyTag, withTag } from '@/query/syntax'

export function useQueryMenus() {
  const router = useRouter()
  const follows = useFollows()
  const blacklist = useBlacklist()
  const ui = useUi()

  const searchHref = (q: string) => router.resolve({ path: '/posts', query: q ? { q } : {} }).href
  const search = (q: string) => void router.push({ path: '/posts', query: q ? { q } : {} })
  async function copy(text: string, what: string) {
    ui.toast((await copyText(text)) ? `${what} copied` : 'Could not copy')
  }

  /** A query (a recent search, a quick link): run it, elsewhere, follow it. */
  function searchEntries(q: string): MenuEntry[] {
    const followed = follows.isFollowed(q)
    return [
      { label: 'Search', icon: 'search', href: searchHref(q), run: () => search(q) },
      { label: 'Search in a new tab', icon: 'external', run: () => openInNewTab(searchHref(q)) },
      'sep',
      !!q.trim() && {
        label: followed ? 'Unfollow' : 'Follow this search',
        icon: 'eye',
        checked: followed || undefined,
        run: () => {
          follows.toggle(q)
          ui.toast(followed ? 'Search unfollowed' : 'Following this search → new posts show on Following', { tone: followed ? undefined : 'ok' })
        },
      },
      { label: 'Copy the query', icon: 'copy', run: () => copy(q, 'Query') },
    ].filter(Boolean) as MenuEntry[]
  }

  /** A tag. With `query` (the search on screen), it can also narrow or widen that search; `go`
      runs a search (by default on the results page). */
  function tagEntries(tag: string, opts: { query?: string; go?: (q: string) => void } = {}): MenuEntry[] {
    const go = opts.go ?? search
    const followed = follows.isFollowed(tag)
    const q = opts.query?.trim()
    return [
      { label: `Search ${prettyTag(tag)}`, icon: 'search', href: searchHref(tag), run: () => go(tag) },
      !!q && { label: 'Add to the search', icon: 'plus', href: searchHref(withTag(q, tag)), run: () => go(withTag(q, tag)) },
      !!q && { label: 'Exclude from the search', icon: 'minus', href: searchHref(withTag(q, tag, '-')), run: () => go(withTag(q, tag, '-')) },
      { label: 'Search in a new tab', icon: 'external', run: () => openInNewTab(searchHref(tag)) },
      'sep',
      {
        label: followed ? 'Unfollow' : 'Follow',
        icon: 'eye',
        checked: followed || undefined,
        run: () => {
          follows.toggle(tag)
          ui.toast(followed ? `Unfollowed ${prettyTag(tag)}` : `Following ${prettyTag(tag)} → new posts show on Following`)
        },
      },
      { label: 'Copy the tag', icon: 'copy', run: () => copy(tag, 'Tag') },
      'sep',
      {
        label: 'Blacklist',
        icon: 'eye-off',
        danger: true,
        run: () => {
          blacklist.addLine(tag)
          ui.toast(`Blacklisted ${prettyTag(tag)}`, { action: { label: 'Undo', run: () => blacklist.removeLine(tag) } })
        },
      },
    ].filter(Boolean) as MenuEntry[]
  }

  /** A followed tag or search (Following page, Home). */
  function followEntries(f: Follow): MenuEntry[] {
    const fresh = f.fresh >= follows.CHECK_LIMIT ? `${f.fresh}+` : String(f.fresh)
    const isSearch = follows.kindOf(f) === 'search'
    return [
      { label: f.fresh > 0 ? `Open: ${fresh} new` : 'Open', icon: 'search', href: searchHref(f.tag), run: () => search(f.tag) },
      { label: 'Open in a new tab', icon: 'external', run: () => openInNewTab(searchHref(f.tag)) },
      f.fresh > 0 && {
        label: `Only the ${fresh} new posts`,
        icon: 'eye',
        href: searchHref(`${f.tag} id:>${f.lastSeen}`),
        run: () => {
          search(`${f.tag} id:>${f.lastSeen}`)
          follows.markSeen(f.tag)
        },
      },
      f.fresh > 0 && { label: 'Mark seen', icon: 'check', run: () => follows.markSeen(f.tag) },
      'sep',
      { label: isSearch ? 'Copy the query' : 'Copy the tag', icon: 'copy', run: () => copy(f.tag, isSearch ? 'Query' : 'Tag') },
      'sep',
      { label: 'Unfollow', icon: 'close', danger: true, run: () => follows.unfollow(f.tag) },
    ].filter(Boolean) as MenuEntry[]
  }

  /** Anything followed (Following page, Home): a follow's own menu, or a saved pool's. */
  function inboxEntries(e: InboxEntry): MenuEntry[] {
    if (e.follow) return followEntries(e.follow)
    const p = e.pool!
    const href = router.resolve(`/pools/${p.id}`).href
    const pools = usePoolLibrary()
    return [
      { label: e.fresh ? `Open: ${e.fresh} new ${e.fresh === 1 ? 'page' : 'pages'}` : 'Open', icon: 'pool', href, run: () => void router.push(`/pools/${p.id}`) },
      { label: 'Open in a new tab', icon: 'external', run: () => openInNewTab(href) },
      e.fresh > 0 && { label: 'Mark seen', icon: 'check', run: () => pools.markRead(p.id) },
      'sep',
      { label: 'Remove from the library', icon: 'close', danger: true, run: () => pools.remove(p.id) },
    ].filter(Boolean) as MenuEntry[]
  }

  return { searchHref, search, copy, searchEntries, tagEntries, followEntries, inboxEntries }
}
