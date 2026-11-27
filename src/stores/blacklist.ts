import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { persistent } from './persist'
import { useSettings } from './settings'
import { parseRange, tokenize, type Token } from '@/query/syntax'
import type { Post } from '@/api/types'

/* One rule per line, in the search language: every plain term must match, no "-" term may match,
   and at least one "~" term must match. Tags take "*" wildcards. The metatags are the site's
   blacklist's own (its help page, e621:blacklist): id, status, rating, type, width, height,
   filesize, score, favcount, fav:me, uploader, user, userid, username, pool and tagcount, with
   numbers as a value, a comparison (>, <, >=, <=) or a range (a..b). Any other term is read as the
   tag it spells (which no post carries), as the site does: it can make a rule narrower, never wider
   (dropping it would hide every post matching the rest of the line). */

interface Rule {
  line: string
  /** Its plain tags that must be there (no wildcard, no metatag): all of them in a search set it
      aside on that search's results, when Settings › Blacklist says so. */
  tags: string[]
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

/** filesize:500kb, filesize:>1mb, filesize:1mb..5mb: the sizes in bytes. */
const bytes = (v: string) => v.replace(/(\d+(?:\.\d+)?)(kb|mb)/g, (_m, n: string, u: string) => String(Math.round(Number(n) * (u === 'kb' ? 1024 : 1024 * 1024))))
/** uploader: and user: take a name, or !id. */
function byUploader(v: string): (p: Post) => boolean {
  const id = /^!(\d+)$/.exec(v)
  return id ? (p) => p.uploaderId === Number(id[1]) : (p) => (p.uploaderName ?? '').toLowerCase() === v
}

/** Metatags of the blacklist that searches do not have: the tokenizer (query/syntax) reads them as
    tags, so they are taken apart here. */
const BLACKLIST_ONLY = /^(uploader|userid|username|filesize|tagcount|status|pool|fav|user):(.+)$/

function predicate(token: Token): ((p: Post, tags: Set<string>) => boolean) | null {
  const own = token.kind === 'tag' && !token.wildcard ? BLACKLIST_ONLY.exec(token.name) : null
  const t: Token = own ? { ...token, kind: 'meta', name: own[1], value: own[2] } : token
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
      case 'status':
        if (v === 'flagged') return (p) => p.flagged
        if (v === 'pending') return (p) => p.pending
        if (v === 'deleted') return (p) => p.deleted
        break
      case 'filesize': {
        const f = numTest(bytes(v))
        return (p) => f(p.size)
      }
      case 'tagcount': {
        const f = numTest(v)
        return (p) => f(p.tags.length)
      }
      case 'fav':
        if (v === 'me') return (p) => p.isFavorited
        break
      case 'uploader':
      case 'user':
        return byUploader(v)
      case 'username':
        return (p) => (p.uploaderName ?? '').toLowerCase() === v
      case 'userid': {
        const f = numTest(v)
        return (p) => p.uploaderId != null && f(p.uploaderId)
      }
      case 'pool':
        if (/^\d+$/.test(v)) return (p) => p.pools.includes(Number(v))
        break
    }
    // Not one the blacklist knows: the tag it spells, as the site reads it (see the top).
    const literal = `${t.name}:${v}`
    return (_p, tags) => tags.has(literal)
  }
  return null
}

function compile(text: string): Rule[] {
  const rules: Rule[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const rule: Rule = { line, tags: [], all: [], none: [], any: [] }
    for (const t of tokenize(line)) {
      const f = predicate(t)
      if (!f) continue
      if (!t.prefix && t.kind === 'tag' && !t.wildcard && !BLACKLIST_ONLY.test(t.name)) rule.tags.push(t.name)
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

export interface BlacklistSynced {
  /** The account ("address|name"). */
  key: string
  account: string
  here: string
  at: number
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
  /** The account's blacklist and this one as they were at the last sync with it (services/blacklistSync):
      what changed since, on either side, is found against them. */
  const synced = persistent<BlacklistSynced | null>('blacklist:synced', null)
  /** Kept in step with the account by itself: additions carry over both ways, removals ask. */
  const auto = persistent<boolean>('blacklist:auto', true)
  const rules = computed(() => compile(text.value))

  /* Lines switched off for this session (the list of what a page's blacklist caught, BlacklistHere):
     their posts show until pawbs is closed, or the line is switched on again. Kept in the tab's
     session storage, so a reload keeps them off. */
  const OFF_KEY = 'ngg:blacklist-off'
  const off = ref(new Set<string>(readOff()))
  function readOff(): string[] {
    try {
      const v = JSON.parse(sessionStorage.getItem(OFF_KEY) ?? '[]')
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  function setLine(line: string, on: boolean) {
    const next = new Set(off.value)
    if (on) next.delete(line)
    else next.add(line)
    off.value = next
    try {
      if (next.size) sessionStorage.setItem(OFF_KEY, JSON.stringify([...next]))
      else sessionStorage.removeItem(OFF_KEY)
    } catch {
      /* not kept past a reload */
    }
  }
  function allOn() {
    for (const l of [...off.value]) setLine(l, true)
  }

  /** The plain tags of the search on screen (views/PostsView): with Settings › Blacklist › Show what
      you search for, a line whose tags are all in it is set aside there. */
  const searchTags = ref(new Set<string>())
  function setSearch(q: string | null) {
    const next = new Set<string>()
    for (const t of q ? tokenize(q) : []) if (!t.prefix && t.kind === 'tag' && !t.wildcard) next.add(t.name)
    if (next.size === searchTags.value.size && [...next].every((t) => searchTags.value.has(t))) return
    searchTags.value = next
  }
  /** A line set aside by the search on screen. */
  function searched(r: Rule): boolean {
    return useSettings().s.blacklistSearched && r.tags.length > 0 && r.tags.every((t) => searchTags.value.has(t))
  }

  /** The rules in force: not switched off, not set aside by the search. */
  const active = computed(() => {
    void searchTags.value
    void useSettings().s.blacklistSearched
    return rules.value.filter((r) => !off.value.has(r.line) && !searched(r))
  })

  // Results per post object, dropped whenever the rules in force change.
  let memo = new WeakMap<Post, string | null>()
  let memoRules: Rule[] | null = null

  function matches(r: Rule, post: Post, tags: Set<string>): boolean {
    if (r.all.length && !r.all.every((f) => f(post, tags))) return false
    if (r.none.some((f) => f(post, tags))) return false
    if (r.any.length && !r.any.some((f) => f(post, tags))) return false
    return true
  }

  function match(post: Post): string | null {
    if (!enabled.value || !rules.value.length) return null
    if (revealed.value.has(post.id)) return null
    const list = active.value
    if (memoRules !== list) {
      memo = new WeakMap()
      memoRules = list
    }
    const hit = memo.get(post)
    if (hit !== undefined) return hit
    const tags = new Set(post.tags)
    const r = list.find((x) => matches(x, post, tags))
    const out = r ? r.line : null
    memo.set(post, out)
    return out
  }

  /** What every line catches among `posts`, switched off or set aside or not (revealed posts
      aside): how many posts any line catches, and the lines with a post, each with its count and
      whether it is in force. */
  function catches(posts: Post[]): { total: number; lines: { line: string; count: number; on: boolean; searched: boolean }[] } {
    if (!enabled.value) return { total: 0, lines: [] }
    const counts = new Map<Rule, number>()
    let total = 0
    for (const p of posts) {
      if (revealed.value.has(p.id)) continue
      const tags = new Set(p.tags)
      let any = false
      for (const r of rules.value) {
        if (!matches(r, p, tags)) continue
        counts.set(r, (counts.get(r) ?? 0) + 1)
        any = true
      }
      if (any) total++
    }
    const lines = rules.value.filter((r) => counts.has(r)).map((r) => ({ line: r.line, count: counts.get(r)!, on: !off.value.has(r.line), searched: searched(r) }))
    return { total, lines }
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

  return { text, enabled, rules, active, match, catches, reveal, addLine, removeLine, revealed, off, setLine, allOn, searchTags, setSearch, conflict, compared, synced, auto }
})
