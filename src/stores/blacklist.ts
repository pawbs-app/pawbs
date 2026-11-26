import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { persistent } from './persist'
import { parseRange, tokenize, type Token } from '@/query/syntax'
import type { Post } from '@/api/types'

/* One rule per line, in the search language: every plain term must match, no "-" term may match,
   and at least one "~" term must match. rating:, type:, score:, favcount:, width:, height:, id:
   are understood; tags take "*" wildcards. */

interface Rule {
  line: string
  all: ((p: Post, tags: Set<string>) => boolean)[]
  none: ((p: Post, tags: Set<string>) => boolean)[]
  any: ((p: Post, tags: Set<string>) => boolean)[]
}

function numTest(v: string): (n: number) => boolean {
  const r = parseRange(v)
  const min = r.min === '' ? -Infinity : Number(r.min)
  const max = r.max === '' ? Infinity : Number(r.max)
  return (n) => n >= min && n <= max
}

function predicate(t: Token): ((p: Post, tags: Set<string>) => boolean) | null {
  if (t.kind === 'tag') {
    if (t.wildcard) {
      const re = new RegExp('^' + t.name.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
      return (_p, tags) => {
        for (const x of tags) if (re.test(x)) return true
        return false
      }
    }
    return (_p, tags) => tags.has(t.name)
  }
  if (t.kind === 'meta') {
    const v = t.value.toLowerCase()
    switch (t.name) {
      case 'rating':
        return (p) => p.rating === v.charAt(0)
      case 'type':
        return (p) => p.ext === v
      case 'score': {
        const f = numTest(v)
        return (p) => f(p.score.total)
      }
      case 'favcount': {
        const f = numTest(v)
        return (p) => f(p.favCount)
      }
      case 'width': {
        const f = numTest(v)
        return (p) => f(p.width)
      }
      case 'height': {
        const f = numTest(v)
        return (p) => f(p.height)
      }
      case 'id': {
        const f = numTest(v)
        return (p) => f(p.id)
      }
      case 'user':
        return (p) => (p.uploaderName ?? '').toLowerCase() === v
      default:
        return null
    }
  }
  return null
}

function compile(text: string): Rule[] {
  const rules: Rule[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const rule: Rule = { line, all: [], none: [], any: [] }
    for (const t of tokenize(line)) {
      const f = predicate(t)
      if (!f) continue
      if (t.prefix === '-') rule.none.push(f)
      else if (t.prefix === '~') rule.any.push(f)
      else rule.all.push(f)
    }
    if (rule.all.length || rule.any.length) rules.push(rule)
  }
  return rules
}

export interface BlacklistConflict {
  /** The site's address and name, and the account. */
  site: string
  siteName: string
  user: string
  userId: number
  /** The account's blacklist as it was read. */
  account: string
}

export const useBlacklist = defineStore('blacklist', () => {
  const text = persistent<string>('blacklist', '')
  const enabled = persistent<boolean>('blacklist:on', true)
  /** Posts revealed for this session despite a matching rule. */
  const revealed = ref(new Set<number>())
  /** The signed-in account's blacklist differs from this one (services/blacklistSync): kept, and
      pointed out in Settings, until a choice is made. */
  const conflict = persistent<BlacklistConflict | null>('blacklist:conflict', null)
  /** Accounts already compared once ("address|name"), so the check runs once per account. */
  const compared = persistent<string[]>('blacklist:compared', [])
  const rules = computed(() => compile(text.value))
  // Results per post object, dropped whenever the rules change.
  let memo = new WeakMap<Post, string | null>()
  let memoRules: Rule[] | null = null

  function match(post: Post): string | null {
    if (!enabled.value || !rules.value.length) return null
    if (revealed.value.has(post.id)) return null
    if (memoRules !== rules.value) {
      memo = new WeakMap()
      memoRules = rules.value
    }
    const hit = memo.get(post)
    if (hit !== undefined) return hit
    const tags = new Set(post.tags)
    let out: string | null = null
    for (const r of rules.value) {
      if (r.all.length && !r.all.every((f) => f(post, tags))) continue
      if (r.none.some((f) => f(post, tags))) continue
      if (r.any.length && !r.any.some((f) => f(post, tags))) continue
      out = r.line
      break
    }
    memo.set(post, out)
    return out
  }

  function reveal(id: number) {
    const next = new Set(revealed.value)
    next.add(id)
    revealed.value = next
  }

  function addLine(line: string) {
    const l = line.trim()
    if (!l) return
    const lines = text.value.split('\n').map((x) => x.trim())
    if (lines.includes(l)) return
    text.value = [...lines.filter(Boolean), l].join('\n')
  }

  function removeLine(line: string) {
    text.value = text.value
      .split('\n')
      .filter((x) => x.trim() !== line.trim())
      .join('\n')
  }

  return { text, enabled, rules, match, reveal, addLine, removeLine, revealed, conflict, compared }
})
