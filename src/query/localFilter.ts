/* Filtering a list kept in this browser (favourites, collections) with the search language's simple
   form: tags, -tags, wildcards, rating:, type:, and post numbers. */
import type { Post } from '@/api/types'
import { tokenize } from './syntax'

export function filterLocal(posts: Post[], text: string): Post[] {
  const toks = tokenize(text)
  if (!toks.length) return posts
  return posts.filter((p) => {
    const tags = new Set(p.tags)
    return toks.every((t) => {
      let hit: boolean
      if (t.kind === 'meta' && t.name === 'rating') hit = p.rating === t.value.charAt(0).toLowerCase()
      else if (t.kind === 'meta' && t.name === 'type') hit = p.ext === t.value.toLowerCase()
      else if (t.kind === 'tag' && t.wildcard) {
        const re = new RegExp('^' + t.name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
        hit = p.tags.some((x) => re.test(x))
      } else hit = tags.has(t.name) || String(p.id) === t.name
      return t.prefix === '-' ? !hit : hit
    })
  })
}

export type LocalSort = 'added' | 'added_asc' | 'id' | 'score'

/** A list kept newest-added first, in the order asked for. */
export function sortLocal(posts: Post[], sort: LocalSort): Post[] {
  if (sort === 'added_asc') return [...posts].reverse()
  if (sort === 'id') return [...posts].sort((a, b) => b.id - a.id)
  if (sort === 'score') return [...posts].sort((a, b) => b.score.total - a.score.total)
  return posts
}
