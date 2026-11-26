import { computed, type Ref } from 'vue'
import type { Post } from '@/api/types'
import { useBlacklist } from '@/stores/blacklist'
import { useHidden } from '@/stores/hidden'
import { useSettings } from '@/stores/settings'
import { useHistory } from '@/stores/history'
import { seenMode } from './seen'

/** Posts minus the blacklisted ones (when the blacklist hides rather than masks) and the ones marked
    "not interested" (unless `keepHidden` says the list is one's own: favourites, collections). */
export function useVisiblePosts(posts: Ref<Post[]>, opts: { keepHidden?: () => boolean } = {}) {
  const blacklist = useBlacklist()
  const settings = useSettings()
  const notInterested = useHidden()
  const history = useHistory()
  // Posts seen before this list was entered, left out when Settings › Browsing says so (composables/seen).
  const mode = seenMode()
  const hiddenIds = computed(() => {
    void blacklist.rules
    void blacklist.revealed
    void blacklist.enabled
    const s = new Set<number>()
    for (const p of posts.value) if (blacklist.match(p)) s.add(p.id)
    return s
  })
  // Posts the site gives no image for at all (withheld from guests, purged) cannot be shown.
  const usable = (p: Post) => !!(p.previewUrl || p.sampleUrl || p.fileUrl)
  const visible = computed(() => {
    const hide = settings.s.blacklistMode === 'hide' && hiddenIds.value.size > 0
    const gone = opts.keepHidden?.() ? null : notInterested.ids
    const seenBefore = !opts.keepHidden?.() && mode.value === 'hide' ? history.before : null
    const shown = (p: Post) => usable(p) && !(gone?.has(p.id)) && !(hide && hiddenIds.value.has(p.id)) && !seenBefore?.has(p.id)
    if (posts.value.every(shown)) return posts.value
    return posts.value.filter(shown)
  })
  const hiddenCount = computed(() => hiddenIds.value.size)
  const unavailableCount = computed(() => posts.value.reduce((n, p) => n + (usable(p) ? 0 : 1), 0))
  return { visible, hiddenCount, hiddenIds, unavailableCount }
}
