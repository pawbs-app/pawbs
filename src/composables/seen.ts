/* Posts already seen (opened in the gallery, stores/history: seen), shown as the others, dimmed or
   left out (Settings › Browsing). Only where new posts are what one looks for: searches, Following,
   Popular and similar pictures. One's own lists, sets and pools (a comic read again) never change.
   A new list starts when the page or its query changes; the gallery opening over a list does not
   start one (it adds `post` to the address), so the list and the gallery always agree. */
import { computed, type ComputedRef } from 'vue'
import { useRoute, type RouteLocationNormalized } from 'vue-router'
import { useSettings } from '@/stores/settings'

const PAGES = new Set(['posts', 'following', 'popular', 'similar'])

/** The setting, where it applies on the page shown; 'show' elsewhere. */
export function seenMode(): ComputedRef<'show' | 'dim' | 'hide'> {
  const route = useRoute()
  const settings = useSettings()
  return computed(() => (PAGES.has(String(route.name)) ? settings.s.seenPosts : 'show'))
}

/** What makes a list: the page and its query, without the post open over it. */
export function listKey(r: RouteLocationNormalized): string {
  const q = Object.entries(r.query)
    .filter(([k]) => k !== 'post')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&')
  return `${r.path}?${q}`
}
