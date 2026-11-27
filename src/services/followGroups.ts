/* Follow checks in groups. Plain tags the site knows (with a post count in the tag cache: an alias or
   a misspelling has none, and its posts carry another name) are counted from one search of ~tag terms
   for up to GROUP of them, rather than one search a tag. Tags last seen at about the same post go
   together, so a group asks for little more than its tags need. Each post counts for the tags it
   carries that were last seen before it, unless the blacklist hides it. A group whose results run
   past what is read (MAX_PAGES pages) settles only the tags it read far enough back for; the others
   are checked one by one, as before (stores/follows). */
import { searchPosts } from '@/api/endpoints'
import { Priority } from '@/api/client'
import type { Post } from '@/api/types'
import type { Follow } from '@/stores/follows'
import { useSettings } from '@/stores/settings'

/** Tags in one search: under the site's 40 terms, with the id: and type: filters beside them. */
const GROUP = 30
const PAGE = 320
const MAX_PAGES = 2

export interface Count {
  fresh: number
  newest: number
}

export async function countGrouped(fs: Follow[], cap: number, shown: (p: Post) => boolean): Promise<Map<Follow, Count>> {
  const out = new Map<Follow, Count>()
  const sorted = fs.filter((f) => f.lastSeen > 0).sort((a, b) => b.lastSeen - a.lastSeen)
  const flash = useSettings().s.blockFlash ? ' -type:swf' : ''
  for (let i = 0; i < sorted.length; i += GROUP) {
    const group = sorted.slice(i, i + GROUP)
    // One tag alone gains nothing from a group: checked on its own.
    if (group.length < 2) break
    const oldest = Math.min(...group.map((f) => f.lastSeen))
    const byTag = new Map(group.map((f) => [f.tag, f]))
    const counts = new Map<Follow, Count>(group.map((f) => [f, { fresh: 0, newest: 0 }]))
    let lowest = Infinity
    let complete = false
    let page: string | undefined
    for (let n = 0; n < MAX_PAGES; n++) {
      const q = `${group.map((f) => `~${f.tag}`).join(' ')} id:>${oldest}${flash}`
      const posts = await searchPosts(q, { limit: PAGE, page, priority: Priority.Idle, ttl: 0, files: false })
      for (const p of posts) {
        lowest = Math.min(lowest, p.id)
        const visible = shown(p)
        for (const t of p.tags) {
          const f = byTag.get(t)
          if (!f || p.id <= f.lastSeen) continue
          const c = counts.get(f)!
          c.newest = Math.max(c.newest, p.id)
          if (visible) c.fresh++
        }
      }
      if (posts.length < PAGE) {
        complete = true
        break
      }
      page = `b${lowest}`
    }
    for (const [f, c] of counts) {
      // Settled: read back past its last seen post, or past the cap anyway.
      if (complete || f.lastSeen >= lowest - 1 || c.fresh >= cap) out.set(f, { fresh: Math.min(c.fresh, cap), newest: c.newest })
    }
  }
  return out
}
