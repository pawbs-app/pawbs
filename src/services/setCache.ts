/* Sets seen in lists this session, by id: opening one shows it at once instead of fetching it again
   (a set's answer carries all of its posts' ids, which can be large). Per site. */
import type { PostSet } from '@/api/types'
import { useSites } from '@/stores/sites'

const known = new Map<string, PostSet>()
const key = (id: number) => `${useSites().scope}:${id}`

export function rememberSets(list: PostSet[]) {
  for (const s of list) known.set(key(s.id), s)
  // Bounded: the oldest seen go first.
  while (known.size > 400) known.delete(known.keys().next().value!)
}
export function knownSet(id: number): PostSet | undefined {
  return known.get(key(id))
}
export function forgetSet(id: number) {
  known.delete(key(id))
}
