/* The whole post behind a stored copy. Favourites and history keep only part of a post (no pools
   before 1.6.4; history no tags either), so a menu asks for the rest when it opens; it arrives a
   moment later and the menu shows what depended on it (the artists, the pools). Kept for the
   session, per site. */
import { shallowReactive } from 'vue'
import type { Post } from '@/api/types'
import { getPost } from '@/api/endpoints'
import { Priority } from '@/api/client'
import { useSites } from '@/stores/sites'
import { useTagCache } from '@/stores/tagcache'

const full = shallowReactive(new Map<string, Post>())
const asked = new Set<string>()
const key = (id: number) => `${useSites().active?.id ?? ''}:${id}`

/** The post with everything known so far (reactive: the whole post once it has arrived). */
export function detailsOf(p: Post): Post {
  return p.partial ? (full.get(key(p.id)) ?? p) : p
}

/** Get what a menu needs about this post: the rest of a stored copy, and its tags' categories
    (this site lists a post's tags without them; artists are found through the categories). */
export function wantDetails(p: Post) {
  const tagcache = useTagCache()
  const known = detailsOf(p)
  if (known.tags.length) void tagcache.ensure(known.tags, Priority.User)
  if (!p.partial || known !== p) return
  const k = key(p.id)
  if (asked.has(k)) return
  asked.add(k)
  getPost(p.id, { priority: Priority.User })
    .then((f) => {
      if (!f) return
      full.set(k, f)
      void tagcache.ensure(f.tags, Priority.User)
    })
    .catch(() => asked.delete(k)) // asked again next time
}
