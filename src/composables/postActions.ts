/* What can be done with a post, from the gallery (keys, buttons) or a right-click on a thumbnail:
   one implementation, so both behave the same. */
import { useRouter } from 'vue-router'
import type { Post } from '@/api/types'
import { useFavorites } from '@/stores/favorites'
import { useSettings } from '@/stores/settings'
import { useSites } from '@/stores/sites'
import { useTagCache } from '@/stores/tagcache'
import { useUi } from '@/stores/ui'
import { corsKnown, fileName, savePost } from '@/services/download'
import { openInNewTab, type MenuSource } from '@/services/contextMenu'
import { copyText } from '@/composables/dom'
import { prettyTag } from '@/query/syntax'
import { poolName } from '@/services/poolNames'
import { detailsOf, wantDetails } from '@/services/postDetails'
import { useMySets } from '@/stores/mySets'
import { useHidden } from '@/stores/hidden'

export function usePostActions() {
  const router = useRouter()
  const favorites = useFavorites()
  const settings = useSettings()
  const sites = useSites()
  const tagcache = useTagCache()
  const ui = useUi()

  const hidden = useHidden()

  /** Put posts out of sight for good (with an undo in the toast). */
  function notInterested(posts: Post[]) {
    const ids = hidden.hide(posts)
    if (!ids.length) return
    ui.toast(ids.length === 1 ? 'Hidden: you will not see this post again' : `${ids.length} posts hidden for good`, {
      action: { label: 'Undo', run: () => hidden.unhide(ids) },
    })
  }

  const postUrl = (p: Post) => (sites.active ? `${sites.active.url}/posts/${p.id}` : null)

  async function download(p: Post) {
    if (!p.fileUrl) {
      ui.toast('No file to save for this post', { tone: 'warn' })
      return
    }
    const name = () => fileName(p, settings.s.filenamePattern, (t) => p.tagCategories?.[t] ?? tagcache.category(t))
    if (corsKnown(p.fileUrl) === 'no') {
      void savePost(p, name())
      ui.toast('The file host does not allow direct downloads: the original opened in a new tab. Save it from there, or Shift + right-click the picture › Save as.')
      return
    }
    await Promise.race([tagcache.ensure(p.tags), new Promise((r) => setTimeout(r, 800))])
    const n = name()
    const r = await savePost(p, n)
    if (r === 'saved') ui.toast(`Saved → ${n}`, { tone: 'ok' })
    else if (r === 'opened') ui.toast('The file host does not allow direct downloads: the original opened in a new tab. Save it from there.')
  }
  function openOriginal(p: Post) {
    if (p.fileUrl) openInNewTab(p.fileUrl)
  }
  function openOnSite(p: Post) {
    const u = postUrl(p)
    if (u) window.open(u, '_blank', 'noopener,noreferrer')
  }
  async function copyLink(p: Post): Promise<boolean> {
    const u = postUrl(p)
    return !!u && (await copyText(u))
  }
  async function copyFile(p: Post): Promise<boolean> {
    return !!p.fileUrl && (await copyText(p.fileUrl))
  }

  /** The post's artists, as far as their category is known (for "More by …"), without the notices
      filed under the artist category (warnings, posting restrictions, unknown or edited work). */
  const NOT_AN_ARTIST = /warning|dnp|avoid_posting|unknown_artist|anonymous_artist|artist_unknown|third-party_edit|(^|_)edit$/
  function artists(p: Post): string[] {
    return p.tags.filter((t) => (p.tagCategories?.[t] ?? tagcache.category(t)) === 1 && !NOT_AN_ARTIST.test(t)).slice(0, 2)
  }

  /** The part of a post's menu shared by thumbnails and the gallery: saving, the file, links, artists.
      `say` reports the outcome (a toast by default; the gallery flashes it over the picture). */
  function postEntries(p: Post, say: (msg: string) => void = (m) => ui.toast(m)): MenuSource[] {
    const saved = favorites.isSaved(p)
    wantDetails(p)
    return [
      {
        label: saved ? 'Remove from favourites' : 'Save to favourites',
        icon: saved ? 'bookmark-on' : 'bookmark',
        hint: 'S',
        run: () => say(favorites.toggle(p) ? 'Saved to favourites' : 'Removed from favourites'),
      },
      { label: 'Download', icon: 'download', hint: 'D', disabled: !p.fileUrl, run: () => download(p) },
      'sep',
      { label: 'Copy link to the post', icon: 'link', hint: 'C', disabled: !sites.active, run: async () => say((await copyLink(p)) ? 'Link copied' : 'Could not copy the link') },
      { label: 'Copy file address', icon: 'copy', disabled: !p.fileUrl, run: async () => say((await copyFile(p)) ? 'File address copied' : 'Could not copy the address') },
      { label: 'Open the original file', icon: 'external', hint: 'O', disabled: !p.fileUrl, run: () => openOriginal(p) },
      { label: sites.active ? `Open on ${sites.active.name}` : 'Open on the site', icon: 'external', disabled: !sites.active, run: () => openOnSite(p) },
      'sep',
      { label: 'Find similar pictures', icon: 'similar', href: router.resolve(`/similar/${p.id}`).href, run: () => void router.push(`/similar/${p.id}`) },
      { label: useMySets().available ? 'Add to collection or set…' : 'Add to collection…', icon: 'collection', run: () => void (ui.addToSet = { posts: [p] }) },
      hidden.has(p.id)
        ? { label: 'Show this post again', icon: 'eye', run: () => hidden.unhide([p.id]) }
        : { label: 'Not interested', icon: 'eye-off', run: () => notInterested([p]) },
      'sep',
      // Worked out while the menu is open: a stored copy's pools and tags, and which tags are artists,
      // may only be known a moment after it opens (see services/postDetails).
      {
        group: () => {
          const d = detailsOf(p)
          return [
            ...(d.pools ?? []).map((id) => ({
              // The pool's number until its name has been looked up, then the name.
              get label() {
                const name = poolName(id)
                return name ? `Open pool: ${prettyTag(name)}` : `Open pool #${id}`
              },
              icon: 'pool',
              href: router.resolve(`/pools/${id}`).href,
              run: () => void router.push(`/pools/${id}`),
            })),
            ...artists(d).map((a) => ({
              label: `More by ${prettyTag(a)}`,
              icon: 'user',
              href: router.resolve({ path: '/posts', query: { q: a } }).href,
              run: () => void router.push({ path: '/posts', query: { q: a } }),
            })),
          ]
        },
      },
    ]
  }

  return { postUrl, download, openOriginal, openOnSite, copyLink, copyFile, postEntries, notInterested }
}
