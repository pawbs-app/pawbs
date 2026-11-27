import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { Post } from '@/api/types'
import { votePost } from '@/api/endpoints'
import { useSites } from './sites'

/* Votes cast from pawbs, per post: once one is cast, the site's answer (our vote, the score), so the
   gallery's bar and its details panel show the same. Before that, a post's own data says, and it knows
   our vote only when it was loaded with the account (Settings › Account › Send the account with every
   request): a vote pawbs cannot see shows as none. So a press never takes a vote back blindly: the
   vote shown is taken back by pressing it again, any other press sets its own (the site keeps it if
   it was already so). */
export interface VoteState {
  vote: number
  up: number
  down: number
  total: number
}

export const useVotes = defineStore('votes', () => {
  const sites = useSites()
  const cast = ref(new Map<number, VoteState>())
  const busy = ref(new Set<number>())
  // Another site or account: these were theirs.
  watch(
    () => `${sites.scope}|${sites.active?.username ?? ''}`,
    () => (cast.value = new Map()),
  )

  function of(p: Post): VoteState {
    return cast.value.get(p.id) ?? { vote: p.vote, up: p.score.up, down: p.score.down, total: p.score.total }
  }

  /** Up or down (see the top): the vote now. Throws what the site said when it refused it. */
  function vote(p: Post, v: 1 | -1): Promise<number> {
    return send(p, v, of(p).vote !== v)
  }

  /** Up, never taken back: saving to favourites with Settings › Account › Vote up what you save. */
  async function upvote(p: Post): Promise<void> {
    if (of(p).vote > 0) return
    await send(p, 1, true)
  }

  async function send(p: Post, v: 1 | -1, keep: boolean): Promise<number> {
    if (busy.value.has(p.id)) return of(p).vote
    busy.value = new Set(busy.value).add(p.id)
    try {
      const r = await votePost(p.id, v, keep)
      const next = new Map(cast.value)
      next.set(p.id, { vote: r.ourScore, up: r.up, down: r.down, total: r.score })
      cast.value = next
      return r.ourScore
    } finally {
      const b = new Set(busy.value)
      b.delete(p.id)
      busy.value = b
    }
  }

  return { cast, busy, of, vote, upvote }
})
